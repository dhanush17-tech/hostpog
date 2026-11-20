/**
 * @hostpog/js — browser SDK for HostPog native collection.
 *
 * Privacy defaults: no click autocapture unless enabled, no input values or
 * keystrokes ever, query strings stripped from URLs (except utm_*), opt-out
 * honoured before anything is queued or sent.
 */
export interface HostPogConfig {
  /** ingestion endpoint, e.g. http://localhost:3001 */
  host: string;
  /** capture $pageview on load and on SPA navigation (default true) */
  capturePageviews?: boolean;
  /** capture clicks on buttons/links as $autocapture (default false) */
  autocaptureClicks?: boolean;
  /** start opted out until optIn() is called (consent banners) */
  optOutByDefault?: boolean;
  /** query parameters kept in $current_url (utm_* always kept) */
  allowedQueryParams?: string[];
  /** elements matching this selector (and descendants) are never autocaptured */
  blockSelector?: string;
  flushIntervalMs?: number;
  batchSize?: number;
  maxQueueSize?: number;
  /** 0..1, decided once per device */
  sampleRate?: number;
  sessionTimeoutMs?: number;
  /** last chance to drop/modify an event; return null to drop */
  beforeSend?: (e: QueuedEvent) => QueuedEvent | null;
  /** testing / non-browser */
  transport?: (url: string, body: string, opts: { beacon: boolean }) => Promise<{ status: number }>;
  storage?: Storage | null;
  debug?: boolean;
}

export interface QueuedEvent {
  uuid: string;
  event: string;
  distinct_id: string;
  timestamp: string;
  properties: Record<string, unknown>;
}

const VERSION = "0.1.0";
const KEY = "hostpog";

function uuid(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const b = new Uint8Array(16);
  if (c?.getRandomValues) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

export function sanitizeUrl(raw: string, allowed: string[] = []): string {
  try {
    const u = new URL(raw);
    const keep = new URLSearchParams();
    u.searchParams.forEach((v, k) => {
      if (k.startsWith("utm_") || allowed.includes(k)) keep.set(k, v);
    });
    u.search = keep.toString();
    u.hash = "";
    u.username = "";
    u.password = "";
    return u.toString();
  } catch {
    return "";
  }
}

export function parseUserAgent(ua: string) {
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Other";
  const os = /Windows/.test(ua) ? "Windows" : /iPhone|iPad|iOS/.test(ua) ? "iOS" : /Mac OS X/.test(ua) ? "macOS" : /Android/.test(ua) ? "Android" : /Linux/.test(ua) ? "Linux" : "Other";
  const device = /iPad|Tablet/.test(ua) ? "Tablet" : /Mobi|iPhone|Android/.test(ua) ? "Mobile" : "Desktop";
  return { $browser: browser, $os: os, $device_type: device };
}

interface Persisted {
  distinctId: string;
  identified: boolean;
  optedOut: boolean;
  sampled: boolean;
  session?: { id: string; last: number };
  queue: QueuedEvent[];
}

export class HostPog {
  private cfg!: Required<Omit<HostPogConfig, "beforeSend" | "transport" | "storage" | "blockSelector">> &
    Pick<HostPogConfig, "beforeSend" | "transport" | "blockSelector"> & { storage: Storage | null };
  private apiKey = "";
  private state!: Persisted;
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushing: Promise<void> | null = null;
  private backoffUntil = 0;
  private failures = 0;
  private teardown: (() => void)[] = [];
  private lastPath: string | null = null;
  private flags: Record<string, boolean | string> = {};
  private flagPayloads: Record<string, unknown> = {};
  private flagsLoaded: Promise<void> | null = null;
  private flagListeners: ((flags: Record<string, boolean | string>) => void)[] = [];
  private flagCalls = new Set<string>();

  init(apiKey: string, config: HostPogConfig): this {
    if (!apiKey.startsWith("hp_pk_")) throw new Error("HostPog: expected a project key starting with hp_pk_");
    this.apiKey = apiKey;
    const w = typeof window !== "undefined" ? window : undefined;
    let storage: Storage | null = config.storage === undefined ? null : config.storage;
    if (config.storage === undefined && w) {
      try {
        storage = w.localStorage;
      } catch {
        storage = null;
      }
    }
    this.cfg = {
      host: config.host.replace(/\/$/, ""),
      capturePageviews: config.capturePageviews ?? true,
      autocaptureClicks: config.autocaptureClicks ?? false,
      optOutByDefault: config.optOutByDefault ?? false,
      allowedQueryParams: config.allowedQueryParams ?? [],
      blockSelector: config.blockSelector,
      flushIntervalMs: config.flushIntervalMs ?? 3000,
      batchSize: config.batchSize ?? 20,
      maxQueueSize: config.maxQueueSize ?? 500,
      sampleRate: config.sampleRate ?? 1,
      sessionTimeoutMs: config.sessionTimeoutMs ?? 30 * 60_000,
      beforeSend: config.beforeSend,
      transport: config.transport,
      storage,
      debug: config.debug ?? false,
    };
    this.state = this.load();
    this.timer = setInterval(() => void this.flush(), this.cfg.flushIntervalMs);
    if (w) this.attach(w);
    return this;
  }

  private load(): Persisted {
    try {
      const raw = this.cfg.storage?.getItem(KEY);
      if (raw) {
        const p = JSON.parse(raw) as Persisted;
        if (p.distinctId) return { ...p, queue: (p.queue ?? []).slice(-this.cfg.maxQueueSize) };
      }
    } catch {
      /* corrupted storage */
    }
    return {
      distinctId: uuid(),
      identified: false,
      optedOut: this.cfg.optOutByDefault,
      sampled: Math.random() < this.cfg.sampleRate,
      queue: [],
    };
  }

  private save() {
    try {
      this.cfg.storage?.setItem(KEY, JSON.stringify(this.state));
    } catch {
      /* quota exceeded: keep in memory */
    }
  }

  private sessionId(): string {
    const now = Date.now();
    const s = this.state.session;
    if (!s || now - s.last > this.cfg.sessionTimeoutMs) this.state.session = { id: uuid(), last: now };
    else s.last = now;
    return this.state.session!.id;
  }

  private context(): Record<string, unknown> {
    const props: Record<string, unknown> = { $lib: "hostpog-js", $lib_version: VERSION, $session_id: this.sessionId() };
    if (typeof window !== "undefined") {
      const loc = window.location;
      props.$current_url = sanitizeUrl(loc.href, this.cfg.allowedQueryParams);
      props.$pathname = loc.pathname;
      props.$host = loc.host;
      props.$screen_width = window.screen?.width;
      props.$viewport_width = window.innerWidth;
      for (const [k, v] of new URLSearchParams(loc.search)) if (k.startsWith("utm_")) props[k] = v.slice(0, 200);
      const ref = typeof document !== "undefined" ? document.referrer : "";
      try {
        props.$referring_domain = ref ? new URL(ref).hostname : "$direct";
      } catch {
        props.$referring_domain = "$direct";
      }
      Object.assign(props, parseUserAgent(navigator.userAgent));
    }
    return props;
  }

  capture(event: string, properties: Record<string, unknown> = {}): void {
    if (!this.state || this.state.optedOut || !this.state.sampled) return;
    if (!event || event.length > 200) return;
    let e: QueuedEvent | null = {
      uuid: uuid(),
      event,
      distinct_id: this.state.distinctId,
      timestamp: new Date().toISOString(),
      properties: { ...this.context(), ...properties },
    };
    if (this.cfg.beforeSend) e = this.cfg.beforeSend(e);
    if (!e) return;
    this.state.queue.push(e);
    if (this.state.queue.length > this.cfg.maxQueueSize) this.state.queue.splice(0, this.state.queue.length - this.cfg.maxQueueSize);
    this.save();
    if (this.state.queue.length >= this.cfg.batchSize) void this.flush();
  }

  /** Link the anonymous device id to a known user id; optional person properties. */
  identify(userId: string, set: Record<string, unknown> = {}): void {
    if (!this.state || this.state.optedOut || !userId) return;
    const anon = this.state.distinctId;
    if (anon === userId) {
      if (Object.keys(set).length) this.capture("$set", { $set: set });
      return;
    }
    this.state.distinctId = userId;
    this.state.identified = true;
    this.capture("$identify", { $anon_distinct_id: anon, $set: set });
    if (this.flagsLoaded) void this.reloadFeatureFlags(set);
  }

  /* ---------------- Feature flags & experiments ---------------- */

  /** Fetch flags for the current user (called automatically on first use and after identify()). */
  reloadFeatureFlags(personProperties: Record<string, unknown> = {}): Promise<void> {
    if (!this.state) return Promise.resolve();
    const body = JSON.stringify({ distinct_id: this.state.distinctId, person_properties: personProperties });
    this.flagsLoaded = (async () => {
      try {
        const r = await fetch(`${this.cfg.host}/v1/flags`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` }, body });
        if (!r.ok) return;
        const j = (await r.json()) as { flags: Record<string, boolean | string>; payloads: Record<string, unknown> };
        this.flags = j.flags ?? {};
        this.flagPayloads = j.payloads ?? {};
        this.flagCalls.clear();
        for (const l of this.flagListeners) l({ ...this.flags });
      } catch {
        /* keep previous values */
      }
    })();
    return this.flagsLoaded;
  }

  /** Value of a flag: true/false, or the variant key for multivariate flags. Records an exposure for experiments. */
  getFeatureFlag(key: string): boolean | string | undefined {
    if (!this.flagsLoaded) void this.reloadFeatureFlags();
    const v = this.flags[key];
    if (v !== undefined && !this.flagCalls.has(key)) {
      this.flagCalls.add(key);
      this.capture("$feature_flag_called", { $feature_flag: key, $feature_flag_response: v });
    }
    return v;
  }

  isFeatureEnabled(key: string): boolean {
    const v = this.getFeatureFlag(key);
    return v !== undefined && v !== false;
  }

  getFeatureFlagPayload(key: string): unknown {
    return this.flagPayloads[key];
  }

  /** Called once flags load (and on every reload). Returns an unsubscribe function. */
  onFeatureFlags(cb: (flags: Record<string, boolean | string>) => void): () => void {
    this.flagListeners.push(cb);
    if (!this.flagsLoaded) void this.reloadFeatureFlags();
    else void this.flagsLoaded.then(() => cb({ ...this.flags }));
    return () => {
      this.flagListeners = this.flagListeners.filter((x) => x !== cb);
    };
  }

  /** Call on logout: new anonymous id and session. */
  reset(): void {
    if (!this.state) return;
    this.state.distinctId = uuid();
    this.state.identified = false;
    this.state.session = undefined;
    this.save();
  }

  optOut(): void {
    if (!this.state) return;
    this.state.optedOut = true;
    this.state.queue = [];
    this.save();
  }

  optIn(): void {
    if (!this.state) return;
    this.state.optedOut = false;
    this.save();
  }

  hasOptedOut(): boolean {
    return this.state?.optedOut ?? true;
  }

  get distinctId(): string | undefined {
    return this.state?.distinctId;
  }

  async flush(opts: { beacon?: boolean } = {}): Promise<void> {
    if (!this.state || this.state.optedOut || !this.state.queue.length) return;
    if (Date.now() < this.backoffUntil && !opts.beacon) return;
    if (this.flushing) return this.flushing;
    const batch = this.state.queue.slice(0, this.cfg.batchSize);
    const body = JSON.stringify({ api_key: this.apiKey, sent_at: new Date().toISOString(), batch });
    const url = `${this.cfg.host}/v1/batch`;
    this.flushing = (async () => {
      try {
        const res = await this.send(url, body, Boolean(opts.beacon));
        if (res.status >= 200 && res.status < 300) {
          this.drop(batch);
          this.failures = 0;
        } else if (res.status === 429 || res.status >= 500 || res.status === 0) {
          this.scheduleRetry();
        } else {
          // 4xx other than 429: the payload will never be accepted
          if (this.cfg.debug) console.warn(`[hostpog] dropping batch, status ${res.status}`);
          this.drop(batch);
        }
      } catch {
        this.scheduleRetry();
      } finally {
        this.flushing = null;
      }
    })();
    return this.flushing;
  }

  private drop(batch: QueuedEvent[]) {
    const ids = new Set(batch.map((b) => b.uuid));
    this.state.queue = this.state.queue.filter((e) => !ids.has(e.uuid));
    this.save();
  }

  private scheduleRetry() {
    this.failures++;
    const delay = Math.min(60_000, 1000 * 2 ** Math.min(this.failures, 6)) * (0.5 + Math.random() / 2);
    this.backoffUntil = Date.now() + delay;
  }

  private async send(url: string, body: string, beacon: boolean): Promise<{ status: number }> {
    if (this.cfg.transport) return this.cfg.transport(url, body, { beacon });
    if (beacon && typeof navigator !== "undefined" && navigator.sendBeacon && body.length < 60_000) {
      return { status: navigator.sendBeacon(url, new Blob([body], { type: "text/plain" })) ? 200 : 0 };
    }
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: body.length < 60_000 });
    return { status: res.status };
  }

  private attach(w: Window) {
    const onHide = () => {
      if (document.visibilityState === "hidden") void this.flush({ beacon: true });
    };
    document.addEventListener("visibilitychange", onHide);
    w.addEventListener("pagehide", () => void this.flush({ beacon: true }));
    this.teardown.push(() => document.removeEventListener("visibilitychange", onHide));

    if (this.cfg.capturePageviews) {
      const pv = () => {
        if (w.location.pathname === this.lastPath) return;
        this.lastPath = w.location.pathname;
        this.capture("$pageview");
      };
      pv();
      const wrap = (k: "pushState" | "replaceState") => {
        const orig = w.history[k];
        w.history[k] = function (this: History, ...args: Parameters<History["pushState"]>) {
          const r = orig.apply(this, args);
          queueMicrotask(pv);
          return r;
        } as History["pushState"];
        this.teardown.push(() => (w.history[k] = orig));
      };
      wrap("pushState");
      wrap("replaceState");
      w.addEventListener("popstate", pv);
      this.teardown.push(() => w.removeEventListener("popstate", pv));
    }

    if (this.cfg.autocaptureClicks) {
      const onClick = (ev: MouseEvent) => {
        const el = (ev.target as Element | null)?.closest?.("a,button,[role=button],[data-hp-name]");
        if (!el) return;
        if (el.closest("[data-hp-no-capture]") || (this.cfg.blockSelector && el.closest(this.cfg.blockSelector))) return;
        if (el.closest("input,textarea,select,[contenteditable]")) return;
        const name = el.getAttribute("data-hp-name");
        this.capture("$autocapture", {
          $event_type: "click",
          $el_tag: el.tagName.toLowerCase(),
          ...(name ? { $el_name: name.slice(0, 100) } : {}),
          // link targets are sanitized; visible text is NOT captured by default
          ...(el instanceof HTMLAnchorElement && el.href ? { $el_href: sanitizeUrl(el.href) } : {}),
        });
      };
      document.addEventListener("click", onClick, true);
      this.teardown.push(() => document.removeEventListener("click", onClick, true));
    }
  }

  async shutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.teardown.forEach((t) => t());
    this.teardown = [];
    await this.flush();
  }
}

/** Default singleton: import hostpog from "@hostpog/js"; hostpog.init(key, { host }) */
const hostpog = new HostPog();
export default hostpog;
