import { ProviderError } from "@hostpog/analytics";
import { sharedBudget, type BudgetCategory, type RequestBudget } from "./budget";

export type PostHogAuth =
  | { type: "api_key"; key: string }
  | { type: "oauth"; accessToken: string; refresh?: () => Promise<string> };

export interface PostHogClientOpts {
  host: string;
  auth: PostHogAuth;
  /** stable, non-secret identifier used to key budgets and caches */
  credentialKey: string;
  budget?: RequestBudget;
  fetch?: typeof fetch;
  timeoutMs?: number;
  maxRetries?: number;
  /** test hook */
  sleep?: (ms: number) => Promise<void>;
  /** observer for metrics (status, latency, retries) */
  onRequest?: (info: { path: string; status: number | "network"; ms: number; attempt: number }) => void;
}

export interface RequestOpts {
  method?: "GET" | "POST" | "DELETE";
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  signal?: AbortSignal;
  category?: BudgetCategory;
}

const defaultSleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function parseRetryAfter(v: string | null): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  if (Number.isFinite(n)) return Math.max(0, n);
  const d = Date.parse(v);
  return Number.isNaN(d) ? undefined : Math.max(0, Math.ceil((d - Date.now()) / 1000));
}

function missingScope(detail: string): string | undefined {
  return /missing required scope '([a-z_:]+)'/i.exec(detail)?.[1];
}

export class PostHogClient {
  private readonly f: typeof fetch;
  private auth: PostHogAuth;
  constructor(private readonly o: PostHogClientOpts) {
    this.f = o.fetch ?? fetch;
    this.auth = o.auth;
  }

  get host() {
    return this.o.host;
  }

  private headers(): Record<string, string> {
    const token = this.auth.type === "api_key" ? this.auth.key : this.auth.accessToken;
    return {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "User-Agent": "hostpog-connector/0.1 (+self-hosted)",
    };
  }

  /** Resolve a path or a pagination `next` URL — only ever against our configured host. */
  private url(pathOrUrl: string, query?: RequestOpts["query"]): URL {
    const u = new URL(pathOrUrl, this.o.host);
    if (u.origin !== new URL(this.o.host).origin) {
      throw new ProviderError("bad_query", `refusing to follow URL outside ${this.o.host}`);
    }
    for (const [k, v] of Object.entries(query ?? {})) if (v !== undefined) u.searchParams.set(k, String(v));
    return u;
  }

  async request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
    const method = opts.method ?? "GET";
    const category = opts.category ?? "crud";
    const wait = (this.o.budget ?? sharedBudget).take(this.o.credentialKey, category);
    if (wait > 0) {
      throw new ProviderError("budget_exhausted", `HostPog request budget for PostHog ${category} calls is used up`, {
        retryAfterSeconds: wait,
      });
    }
    const url = this.url(path, opts.query);
    const maxRetries = this.o.maxRetries ?? 3;
    const sleep = this.o.sleep ?? defaultSleep;
    const deadline = Date.now() + (this.o.timeoutMs ?? 45_000);
    let refreshed = false;

    for (let attempt = 0; ; attempt++) {
      if (opts.signal?.aborted) throw new ProviderError("cancelled", "request cancelled");
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new ProviderError("timeout", "PostHog request deadline exceeded");
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), Math.min(remaining, 30_000));
      const onAbort = () => ctl.abort();
      opts.signal?.addEventListener("abort", onAbort, { once: true });
      const started = Date.now();
      let res: Response;
      try {
        res = await this.f(url, {
          method,
          headers: { ...this.headers(), ...(opts.body !== undefined ? { "Content-Type": "application/json" } : {}) },
          body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
          signal: ctl.signal,
          redirect: "error",
        });
      } catch (err) {
        clearTimeout(timer);
        opts.signal?.removeEventListener("abort", onAbort);
        this.o.onRequest?.({ path: url.pathname, status: "network", ms: Date.now() - started, attempt });
        if (opts.signal?.aborted) throw new ProviderError("cancelled", "request cancelled");
        if (attempt < maxRetries) {
          await sleep(this.backoff(attempt));
          continue;
        }
        throw new ProviderError("upstream", `could not reach PostHog: ${(err as Error).message}`, { cause: err });
      }
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
      this.o.onRequest?.({ path: url.pathname, status: res.status, ms: Date.now() - started, attempt });

      if (res.ok) {
        if (res.status === 204) return undefined as T;
        return (await res.json()) as T;
      }

      const text = await res.text().catch(() => "");
      let detail = text.slice(0, 500);
      try {
        const j = JSON.parse(text) as { detail?: string; error?: string; code?: string };
        detail = j.detail ?? j.error ?? detail;
      } catch {
        /* not json */
      }

      if (res.status === 401) {
        if (this.auth.type === "oauth" && this.auth.refresh && !refreshed) {
          refreshed = true;
          this.auth = { ...this.auth, accessToken: await this.auth.refresh() };
          continue;
        }
        throw new ProviderError("unauthorized", "PostHog rejected the credential (expired, revoked or invalid). Reconnect PostHog.", {
          status: 401,
        });
      }
      // PostHog answers an invalid/revoked personal API key with 403 + code "authentication_failed"
      const authFailed = res.status === 403 && /authentication_failed|api key .*is invalid|invalid personal api key/i.test(text);
      if (res.status === 401 || authFailed) {
        if (this.auth.type === "oauth" && this.auth.refresh && !refreshed) {
          refreshed = true;
          this.auth = { ...this.auth, accessToken: await this.auth.refresh() };
          continue;
        }
        throw new ProviderError("unauthorized", "PostHog rejected the credential (expired, revoked or invalid). Reconnect PostHog.", { status: res.status });
      }
      if (res.status === 403) {
        const scope = missingScope(detail);
        throw new ProviderError(
          "forbidden",
          scope ? `The PostHog credential is missing the scope ${scope}.` : `PostHog denied access: ${detail}`,
          { status: 403, missingScope: scope },
        );
      }
      if (res.status === 404) throw new ProviderError("not_found", `PostHog resource not found: ${url.pathname}`, { status: 404 });
      if (res.status === 400) throw new ProviderError("bad_query", `PostHog rejected the request: ${detail}`, { status: 400 });
      if (res.status === 429) {
        const ra = parseRetryAfter(res.headers.get("retry-after"));
        if (attempt < maxRetries && (ra ?? 1) <= 10 && Date.now() + (ra ?? 1) * 1000 < deadline) {
          await sleep((ra ?? 1) * 1000 + this.backoff(attempt));
          continue;
        }
        throw new ProviderError("rate_limited", "PostHog rate limit reached for this credential.", {
          status: 429,
          retryAfterSeconds: ra,
        });
      }
      if (res.status >= 500) {
        if (attempt < maxRetries) {
          await sleep(this.backoff(attempt));
          continue;
        }
        throw new ProviderError("upstream", `PostHog returned ${res.status}`, { status: res.status });
      }
      throw new ProviderError("upstream", `unexpected PostHog response ${res.status}: ${detail}`, { status: res.status });
    }
  }

  /** exponential backoff with full jitter */
  private backoff(attempt: number): number {
    const cap = 8000;
    const base = 400 * 2 ** attempt;
    return Math.floor(Math.random() * Math.min(cap, base));
  }

  /** Follow `next` links (same host only) up to maxPages. */
  async paginate<T>(path: string, opts: RequestOpts & { maxPages?: number } = {}): Promise<T[]> {
    const out: T[] = [];
    let next: string | null = path;
    let page = 0;
    let query = opts.query;
    while (next && page < (opts.maxPages ?? 5)) {
      const res: { results: T[]; next?: string | null } = await this.request(next, { ...opts, query });
      out.push(...(res.results ?? []));
      next = res.next ?? null;
      query = undefined; // next URLs already carry their query
      page++;
    }
    return out;
  }
}
