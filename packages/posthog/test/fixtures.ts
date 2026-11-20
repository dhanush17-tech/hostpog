/**
 * Contract fixtures modelled on documented PostHog responses
 * (docs/posthog-contract.md). SYNTHETIC — not captured from a live account.
 */
export const ME = {
  email: "owner@example.test",
  organization: { id: "org-1", name: "Example Org", teams: [{ id: 101, name: "Web app", timezone: "America/Phoenix" }] },
  organizations: [{ id: "org-1", name: "Example Org" }],
};

export const PROJECTS_PAGE_1 = {
  count: 2,
  next: "https://us.posthog.com/api/organizations/org-1/projects/?limit=1&offset=1",
  previous: null,
  results: [{ id: 101, uuid: "u-101", organization: "org-1", name: "Web app", timezone: "America/Phoenix" }],
};
export const PROJECTS_PAGE_2 = {
  count: 2,
  next: null,
  previous: "https://us.posthog.com/api/organizations/org-1/projects/?limit=1",
  results: [{ id: 102, uuid: "u-102", organization: "org-1", name: "Marketing site", timezone: "UTC" }],
};

export const EVENT_DEFS = {
  next: null,
  previous: null,
  results: [
    { name: "$pageview", volume_30_day: 1200, last_seen_at: "2026-11-17T10:00:00Z" },
    { name: "signed_up", volume_30_day: 80, last_seen_at: "2026-11-17T09:00:00Z" },
  ],
};

export function hogqlResponse(columns: string[], results: unknown[][], extra: Record<string, unknown> = {}) {
  return { columns, results, types: columns.map(() => "String"), is_cached: false, hasMore: false, ...extra };
}

type Handler = (req: { method: string; url: URL; body: unknown; headers: Headers }) => Response | Promise<Response>;

export function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });
}

export function mockFetch(routes: Record<string, Handler | Handler[]>) {
  const calls: { method: string; path: string; body: unknown; auth: string | null }[] = [];
  const counters = new Map<string, number>();
  const f = (async (input: URL | string, init?: RequestInit) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    const headers = new Headers(init?.headers);
    calls.push({ method, path: url.pathname + url.search, body, auth: headers.get("authorization") });
    const key = `${method} ${url.pathname}`;
    const h = routes[key];
    if (!h) return json({ detail: `no fixture for ${key}` }, 404);
    if (Array.isArray(h)) {
      const i = counters.get(key) ?? 0;
      counters.set(key, i + 1);
      return h[Math.min(i, h.length - 1)]!({ method, url, body, headers });
    }
    return h({ method, url, body, headers });
  }) as typeof fetch;
  return { fetch: f, calls };
}
