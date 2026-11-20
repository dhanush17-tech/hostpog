import { describe, expect, it } from "vitest";
import { ProviderError } from "@hostpog/analytics";
import { RequestBudget } from "../src/budget";
import { CoalescingCache } from "../src/cache";
import { PostHogClient } from "../src/client";
import { discoverProjects, probeScopes } from "../src/discovery";
import { resolvePostHogHost } from "../src/hosts";
import { PostHogProvider } from "../src/provider";
import { EVENT_DEFS, ME, PROJECTS_PAGE_1, PROJECTS_PAGE_2, hogqlResponse, json, mockFetch } from "./fixtures";

const HOST = "https://us.posthog.com";
const noSleep = async () => {};

function client(f: typeof fetch, extra: Partial<ConstructorParameters<typeof PostHogClient>[0]> = {}) {
  return new PostHogClient({
    host: HOST,
    auth: { type: "api_key", key: "phx_test_key" },
    credentialKey: `t-${Math.random()}`,
    fetch: f,
    sleep: noSleep,
    budget: new RequestBudget(),
    ...extra,
  });
}

describe("PostHogClient contract", () => {
  it("sends bearer auth and follows same-host pagination", async () => {
    const m = mockFetch({
      "GET /api/users/@me/": () => json(ME),
      "GET /api/organizations/org-1/projects/": [() => json(PROJECTS_PAGE_1), () => json(PROJECTS_PAGE_2)],
    });
    const d = await discoverProjects(client(m.fetch));
    expect(d.projects.map((p) => p.id)).toEqual(["101", "102"]);
    expect(d.projects[0]!.timezone).toBe("America/Phoenix");
    expect(m.calls.every((c) => c.auth === "Bearer phx_test_key")).toBe(true);
    expect(m.calls[2]!.path).toContain("offset=1");
  });

  it("refuses pagination links to another host", async () => {
    const m = mockFetch({
      "GET /api/users/@me/": () => json(ME),
      "GET /api/organizations/org-1/projects/": () => json({ ...PROJECTS_PAGE_1, next: "https://evil.example/steal" }),
    });
    const d = await discoverProjects(client(m.fetch));
    expect(d.warnings.join(" ")).toMatch(/outside/);
    // falls back to teams embedded in /@me
    expect(d.projects.map((p) => p.id)).toEqual(["101"]);
  });

  it("maps 401 to unauthorized without retrying", async () => {
    const m = mockFetch({ "GET /api/users/@me/": () => json({ detail: "Invalid token" }, 401) });
    await expect(discoverProjects(client(m.fetch))).rejects.toMatchObject({ code: "unauthorized" });
    expect(m.calls).toHaveLength(1);
  });

  it("treats PostHog's 403 authentication_failed as an invalid credential", async () => {
    const m = mockFetch({
      "GET /x/": () => json({ type: "authentication_error", code: "authentication_failed", detail: "Personal API key found in request Authorization header is invalid." }, 403),
    });
    await expect(client(m.fetch).request("/x/")).rejects.toMatchObject({ code: "unauthorized" });
  });

  it("extracts the missing scope from 403 responses", async () => {
    const m = mockFetch({
      "GET /api/projects/101/event_definitions/": () => json({ detail: "API key missing required scope 'event_definition:read'" }, 403),
    });
    const err = (await client(m.fetch).request("/api/projects/101/event_definitions/").catch((e: unknown) => e)) as ProviderError;
    expect(err).toBeInstanceOf(ProviderError);
    expect(err.code).toBe("forbidden");
    expect(err.missingScope).toBe("event_definition:read");
  });

  it("retries 429 honouring Retry-After, then succeeds", async () => {
    const slept: number[] = [];
    const m = mockFetch({
      "GET /api/projects/101/event_definitions/": [() => json({ detail: "throttled" }, 429, { "retry-after": "2" }), () => json(EVENT_DEFS)],
    });
    const c = client(m.fetch, { sleep: async (ms) => void slept.push(ms) });
    const res = await c.request<typeof EVENT_DEFS>("/api/projects/101/event_definitions/");
    expect(res.results).toHaveLength(2);
    expect(slept[0]).toBeGreaterThanOrEqual(2000);
  });

  it("surfaces rate_limited when Retry-After is long", async () => {
    const m = mockFetch({ "GET /x/": () => json({}, 429, { "retry-after": "3600" }) });
    await expect(client(m.fetch).request("/x/")).rejects.toMatchObject({ code: "rate_limited", retryAfterSeconds: 3600 });
  });

  it("retries 5xx with backoff and gives up after maxRetries", async () => {
    const m = mockFetch({ "GET /x/": () => json({}, 503) });
    await expect(client(m.fetch, { maxRetries: 2 }).request("/x/")).rejects.toMatchObject({ code: "upstream", status: 503 });
    expect(m.calls).toHaveLength(3);
  });

  it("refreshes an expired OAuth token once", async () => {
    let n = 0;
    const m = mockFetch({
      "GET /x/": ({ headers }) => (headers.get("authorization") === "Bearer new" ? json({ ok: true }) : json({}, 401)),
    });
    const c = new PostHogClient({
      host: HOST,
      credentialKey: "oauth",
      fetch: m.fetch,
      sleep: noSleep,
      budget: new RequestBudget(),
      auth: { type: "oauth", accessToken: "old", refresh: async () => (n++, "new") },
    });
    await expect(c.request("/x/")).resolves.toEqual({ ok: true });
    expect(n).toBe(1);
  });

  it("enforces the client-side query budget", async () => {
    const m = mockFetch({ "POST /api/projects/1/query/": () => json(hogqlResponse(["x"], [[1]])) });
    const budget = new RequestBudget({ query: { perMinute: 2, perHour: 10 }, analytics: { perMinute: 1, perHour: 1 }, crud: { perMinute: 1, perHour: 1 } });
    process.env.HOSTPOG_POSTHOG_BUDGET_FRACTION = "1";
    const c = client(m.fetch, { budget, credentialKey: "budget" });
    await c.request("/api/projects/1/query/", { method: "POST", category: "query", body: {} });
    await c.request("/api/projects/1/query/", { method: "POST", category: "query", body: {} });
    await expect(c.request("/api/projects/1/query/", { method: "POST", category: "query", body: {} })).rejects.toMatchObject({
      code: "budget_exhausted",
    });
    delete process.env.HOSTPOG_POSTHOG_BUDGET_FRACTION;
  });

  it("probes scopes and reports partial permissions", async () => {
    const m = mockFetch({
      "POST /api/projects/101/query/": () => json(hogqlResponse(["1"], [[1]])),
      "GET /api/projects/101/event_definitions/": () => json(EVENT_DEFS),
      "GET /api/projects/101/session_recordings/": () => json({ detail: "API key missing required scope 'session_recording:read'" }, 403),
      "GET /api/projects/101/insights/": () => json({ results: [] }),
    });
    const res = await probeScopes(client(m.fetch), "101");
    expect(res.filter((r) => !r.ok).map((r) => r.scope)).toEqual(["session_recording:read"]);
  });
});

describe("self-hosted host approval (SSRF)", () => {
  it("rejects unapproved instances and accepts approved ones", () => {
    delete process.env.HOSTPOG_POSTHOG_ALLOWED_HOSTS;
    expect(() => resolvePostHogHost("self_hosted", "https://169.254.169.254")).toThrow(/not approved/);
    process.env.HOSTPOG_POSTHOG_ALLOWED_HOSTS = "https://posthog.internal.example";
    expect(resolvePostHogHost("self_hosted", "https://posthog.internal.example/some/path")).toBe("https://posthog.internal.example");
    expect(() => resolvePostHogHost("self_hosted", "https://user:pw@posthog.internal.example")).toThrow(/credentials/);
    delete process.env.HOSTPOG_POSTHOG_ALLOWED_HOSTS;
  });
});

describe("PostHogProvider", () => {
  function provider(f: typeof fetch, scopes: string[] | null = null) {
    return new PostHogProvider({
      client: client(f),
      tenantKey: "ws1",
      sourceId: "src1",
      label: "PostHog · Web app",
      region: "us",
      externalProjectId: "101",
      timezone: "UTC",
      verifiedScopes: scopes,
      cache: new CoalescingCache(),
    });
  }

  it("compiles a trend to HogQL with values placeholders and zero-fills buckets", async () => {
    const m = mockFetch({
      "POST /api/projects/101/query/": ({ body }) => {
        const b = body as { query: { kind: string; query: string; values: Record<string, unknown> } };
        expect(b.query.kind).toBe("HogQLQuery");
        expect(b.query.query).not.toContain("signed_up"); // event name travels as a value
        expect(Object.values(b.query.values)).toContain("signed_up");
        return json(hogqlResponse(["t", "v"], [["2026-11-16 00:00:00", 3], ["2026-11-18 00:00:00", 5]]));
      },
    });
    const env = await provider(m.fetch).query({
      kind: "trend",
      series: [{ event: "signed_up", math: "total", filters: [] }],
      interval: "day",
      dateRange: { from: "2026-11-15", to: "2026-11-19" },
      compare: false,
      filters: [],
    });
    expect(env.result.series[0]!.points).toEqual([
      { t: "2026-11-15", v: 0 },
      { t: "2026-11-16", v: 3 },
      { t: "2026-11-17", v: 0 },
      { t: "2026-11-18", v: 5 },
    ]);
    expect(env.result.series[0]!.total).toBe(8);
    expect(env.source).toMatchObject({ kind: "posthog", externalProjectId: "101" });
    expect(env.queries[0]!.dialect).toBe("hogql");
    expect(env.range).toEqual({ from: "2026-11-15T00:00:00.000Z", to: "2026-11-19T00:00:00.000Z" });
  });

  it("reports cached results and data_as_of from PostHog", async () => {
    const m = mockFetch({
      "POST /api/projects/101/query/": () =>
        json(hogqlResponse(["events", "users", "prev_events", "prev_users"], [[10, 4, 8, 3]], { is_cached: true, last_refresh: "2026-11-18T10:00:00Z" })),
    });
    const env = await provider(m.fetch, ["query:read"]).query({ kind: "summary", dateRange: { from: "-7d", to: "now" } });
    expect(env.cached).toBe(true);
    expect(env.dataAsOf).toBe("2026-11-18T10:00:00.000Z");
    expect(env.result.events).toBe(10);
  });

  it("degrades gracefully when person data is forbidden", async () => {
    let call = 0;
    const m = mockFetch({
      "POST /api/projects/101/query/": () =>
        call++ === 0
          ? json(hogqlResponse(["events", "users", "prev_events", "prev_users"], [[10, 4, 8, 3]]))
          : json({ detail: "API key missing required scope 'person:read'" }, 403),
    });
    const env = await provider(m.fetch).query({ kind: "summary", dateRange: { from: "-7d", to: "now" } });
    expect(env.result.newUsers).toBeNull();
    expect(env.warnings.join(" ")).toMatch(/New users unavailable/);
  });

  it("coalesces identical concurrent queries", async () => {
    const m = mockFetch({ "POST /api/projects/101/query/": () => json(hogqlResponse(["value", "c", "u"], [["Chrome", 5, 2]])) });
    const p = provider(m.fetch);
    const q = { kind: "top" as const, event: "$pageview", groupBy: { type: "event" as const, key: "$browser", limit: 5 }, dateRange: { from: "-7d", to: "now" }, filters: [], limit: 5 };
    await Promise.all([p.query(q), p.query(q), p.query(q)]);
    expect(m.calls.filter((c) => c.path.includes("/query/"))).toHaveLength(1);
  });

  it("hides replay links without session_recording:read", async () => {
    const m = mockFetch({ "POST /api/projects/101/query/": () => json(hogqlResponse(["sid", "did", "start", "dur"], [["s1", "d1", "2026-11-18 10:00:00", 30]])) });
    const without = await provider(m.fetch, ["query:read"]).listSessions({});
    expect(without.result[0]!.externalUrl).toBeUndefined();
    const withScope = await provider(m.fetch, ["query:read", "session_recording:read"]).listSessions({});
    expect(withScope.result[0]!.externalUrl).toBe("https://us.posthog.com/project/101/replay/s1");
  });

  it("lists capabilities from verified scopes", async () => {
    const caps = await provider(mockFetch({}).fetch, ["query:read"]).capabilities();
    expect(caps.supported).toContain("trends");
    expect(caps.unavailable.map((u) => u.capability)).toContain("event_definitions");
    expect(caps.unavailable.map((u) => u.capability)).toContain("replay_playback");
  });
});
