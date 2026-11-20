/**
 * Opt-in LIVE check of the full HostPog connect path against a real PostHog project,
 * through HostPog's own HTTP API (sign up → discover → connect → every page's data).
 * Read-only towards PostHog.
 *
 *   POSTHOG_LIVE_KEY=phx_... [POSTHOG_LIVE_REGION=us] node e2e/live-posthog.mjs [http://localhost:3000]
 */
const base = process.argv[2] ?? "http://localhost:3000";
const key = process.env.POSTHOG_LIVE_KEY;
const region = process.env.POSTHOG_LIVE_REGION ?? "us";
if (!key) {
  console.error("Set POSTHOG_LIVE_KEY");
  process.exit(2);
}
let cookie = "";
let failures = 0;
async function call(method, path, body) {
  const res = await fetch(base + path, {
    method,
    headers: { "content-type": "application/json", origin: base, cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
  const set = res.headers.getSetCookie?.() ?? [];
  if (set.length) cookie = [...cookie.split("; ").filter(Boolean), ...set.map((c) => c.split(";")[0])].join("; ");
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = text;
  }
  return { status: res.status, json };
}
async function step(name, fn) {
  const t = Date.now();
  try {
    const out = await fn();
    console.log(`✔ ${name} (${Date.now() - t} ms)${out ? ` — ${out}` : ""}`);
  } catch (e) {
    failures++;
    console.log(`✘ ${name}: ${e.message}`);
  }
}
const must = (r, code = 200) => {
  if (r.status !== code) throw new Error(`HTTP ${r.status}: ${JSON.stringify(r.json).slice(0, 300)}`);
  return r.json;
};

let projectId = "";
let externalId = "";
let sourceId = "";
await step("sign up", async () => {
  must(await call("POST", "/api/auth/sign-up/email", { name: "Live Check", email: `live-${Date.now()}@example.test`, password: "live-check-password-123" }));
  const me = must(await call("GET", "/api/v1/me"));
  projectId = me.workspaces[0].projects[0].id;
  return `project ${projectId}`;
});
await step("discover PostHog projects", async () => {
  const d = must(await call("POST", `/api/v1/projects/${projectId}/posthog/discover`, { region, apiKey: key }));
  externalId = d.projects[0]?.id;
  if (!externalId) throw new Error(`no projects: ${JSON.stringify(d.warnings)}`);
  return d.projects.map((p) => `${p.id} ${p.name} (${p.timezone})`).join(", ");
});
await step("connect read-only + first query", async () => {
  const r = must(await call("POST", `/api/v1/projects/${projectId}/posthog/connect`, { region, apiKey: key, externalProjectId: externalId }), 201);
  sourceId = r.source.id;
  if (r.firstError) throw new Error(`first query failed: ${r.firstError}`);
  const s = r.firstResult.result;
  return `events=${s.events} users=${s.uniqueUsers} new=${s.newUsers} · scopes ${r.scopes.filter((x) => x.ok).map((x) => x.scope).join(",")} · first result in ${(r.timeToFirstResultMs / 1000).toFixed(1)} s`;
});
const q = (query) => call("POST", `/api/v1/projects/${projectId}/query`, { sourceId, query });
const dr = { from: "-30d", to: "now" };
await step("overview: summary", async () => {
  const r = must(await q({ kind: "summary", dateRange: dr }));
  return `events=${r.result.events} users=${r.result.uniqueUsers} prev=${r.result.previous.events}`;
});
await step("overview: activity trend (2 series)", async () => {
  const r = must(await q({ kind: "trend", series: [{ event: null, math: "total", filters: [] }, { event: null, math: "unique_users", filters: [] }], interval: "day", dateRange: dr, compare: false, filters: [] }));
  return `${r.result.series.map((s) => `${s.label}=${s.total}`).join(" ")}`;
});
await step("overview: top events", async () => {
  const r = must(await q({ kind: "top", event: null, groupBy: { type: "event_name", key: "$event", limit: 10 }, dateRange: dr, filters: [], limit: 10 }));
  return r.result.rows.map((x) => `${x.value}:${x.count}`).join(" ");
});
let events = [];
await step("event definitions", async () => {
  const r = must(await call("GET", `/api/v1/projects/${projectId}/event-definitions?sourceId=${sourceId}`));
  events = r.result.map((d) => d.name);
  return events.slice(0, 8).join(", ");
});
await step("trends: breakdown by $browser + compare", async () => {
  const r = must(await q({ kind: "trend", series: [{ event: events[0] ?? "$pageview", math: "total", filters: [] }], interval: "day", dateRange: dr, compare: true, filters: [], breakdown: { type: "event", key: "$browser", limit: 5 } }));
  return `${r.result.series.length} series, previous ${r.result.previous?.length ?? 0}`;
});
await step("trends: hourly + property filter", async () => {
  must(await q({ kind: "trend", series: [{ event: null, math: "total", filters: [] }], interval: "hour", dateRange: { from: "-24h", to: "now" }, compare: false, filters: [{ type: "event", key: "$browser", operator: "is_set" }] }));
});
let funnel;
await step("funnels", async () => {
  funnel = { kind: "funnel", steps: (events.length >= 2 ? events.slice(0, 2) : ["$pageview", "$pageview"]).map((e) => ({ event: e, filters: [] })), windowSeconds: 14 * 86400, dateRange: dr, filters: [] };
  const r = must(await q(funnel));
  return r.result.steps.map((s) => `${s.event}=${s.count}`).join(" → ");
});
await step("funnels: breakdown", async () => {
  must(await q({ ...funnel, breakdown: { type: "event", key: "$browser", limit: 5 } }));
});
await step("funnels: dropped persons drill-down", async () => {
  const r = must(await q({ ...funnel, kind: "funnel_persons", step: 2, outcome: "dropped", limit: 20 }));
  return `${r.result.persons.length} persons`;
});
await step("retention (daily)", async () => {
  const r = must(await q({ kind: "retention", startEvent: null, returnEvent: null, period: "day", periods: 7, dateRange: { from: "-14d", to: "now" } }));
  return `${r.result.cohorts.length} cohorts`;
});
await step("web analytics", async () => {
  const r = must(await q({ kind: "web", dateRange: dr }));
  return `pageviews=${r.result.pageviews} visitors=${r.result.visitors} sessions=${r.result.sessions} bounce=${r.result.bounceRate}`;
});
let firstPerson = null;
await step("events explorer + pagination", async () => {
  const r = must(await q({ kind: "events", dateRange: dr, limit: 5, filters: [] }));
  firstPerson = r.result.rows.find((x) => x.personId)?.personId ?? null;
  if (r.result.nextCursor) must(await q({ kind: "events", dateRange: dr, limit: 5, filters: [], cursor: r.result.nextCursor }));
  return `${r.result.rows.length} rows, cursor ${r.result.nextCursor ? "followed" : "none"}`;
});
await step("users list", async () => {
  const r = must(await call("GET", `/api/v1/projects/${projectId}/persons?sourceId=${sourceId}`));
  return `${r.result.rows.length} persons`;
});
if (firstPerson) {
  await step("user profile (by person id from events)", async () => {
    const r = await call("GET", `/api/v1/projects/${projectId}/persons/${encodeURIComponent(firstPerson)}?sourceId=${sourceId}`);
    if (r.status === 404) return "no person profile (expected with identified_only)";
    must(r);
    return `${r.json.events.result.rows.length} timeline events`;
  });
}
await step("sessions", async () => {
  const r = must(await call("GET", `/api/v1/projects/${projectId}/sessions?sourceId=${sourceId}`));
  return `${r.sessions.result.length} sessions, replay links ${r.sessions.result.some((s) => s.externalUrl) ? "yes" : "no"}`;
});
await step("source health check", async () => {
  const r = must(await call("POST", `/api/v1/projects/${projectId}/sources/${sourceId}`, { action: "health" }));
  return r.health.message;
});
await step("disconnect deletes credential", async () => {
  must(await call("DELETE", `/api/v1/projects/${projectId}/sources/${sourceId}?mode=disconnect`));
});
console.log(failures ? `\n${failures} step(s) failed` : "\nall live steps passed");
process.exit(failures ? 1 : 0);
