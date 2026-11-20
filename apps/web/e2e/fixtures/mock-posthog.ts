/**
 * SYNTHETIC PostHog API fixture for E2E tests. Implements the documented
 * request/response shapes used by HostPog (docs/posthog-contract.md) and checks
 * that only read endpoints are called with the expected bearer key.
 * Run: tsx e2e/fixtures/mock-posthog.ts  (port 4010)
 */
import { createServer } from "node:http";

export const MOCK_KEY = "phx_e2e_mock_key_0123456789abcdef";
const MOCK_PROJECT_TOKEN = `phc_e2e${Date.now().toString(36)}mocktoken`; // fresh per run: one PostHog project can only be migrated once
const PORT = Number(process.env.MOCK_POSTHOG_PORT ?? 4010);
const calls: { method: string; path: string }[] = [];

function days(n: number) {
  const out: string[] = [];
  const now = new Date();
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i));
    out.push(`${d.toISOString().slice(0, 10)}T00:00:00-07:00`);
  }
  return out;
}

function hogql(query: string): { columns: string[]; results: unknown[][] } {
  if (query.includes("SELECT 1")) return { columns: ["1"], results: [[1]] };
  if (query.includes("AS prev_events")) return { columns: ["events", "users", "prev_events", "prev_users"], results: [[4210, 388, 3980, 371]] };
  if (query.includes("FROM persons") && query.includes("AS cur")) return { columns: ["cur", "prev"], results: [[57, 49]] };
  if (query.includes("windowFunnel")) return { columns: ["s1", "s2", "median_seconds"], results: [[388, 141, 3600]] };
  if (query.includes("AS pageviews")) return { columns: ["pageviews", "visitors", "sessions"], results: [[1900, 350, 610]] };
  if (query.includes("AS entry")) return { columns: ["entry", "sessions", "visitors", "bounced"], results: [["/", 400, 300, 180], ["/pricing", 210, 160, 90]] };
  if (query.includes("AS value")) return { columns: ["value", "c", "u"], results: [["$pageview", 1900, 350], ["signed_up", 141, 141]] };
  if (query.includes("AS uuid"))
    return {
      columns: ["uuid", "event", "distinct_id", "person_id", "timestamp", "session_id", "properties"],
      results: [["0193a0c0-0000-7000-8000-000000000001", "signed_up", "user-1", "11111111-1111-4111-8111-111111111111", new Date().toISOString(), "s-1", JSON.stringify({ $browser: "Chrome", $pathname: "/signup" })]],
    };
  if (query.includes("FROM persons"))
    return { columns: ["id", "created_at", "is_identified", "properties"], results: [["11111111-1111-4111-8111-111111111111", new Date().toISOString(), true, JSON.stringify({ email: "ada@example.test" })]] };
  if (query.includes("person_distinct_ids")) return { columns: ["pid", "ids"], results: [["11111111-1111-4111-8111-111111111111", ["user-1"]]] };
  if (query.includes("AS t")) return { columns: ["t", "v"], results: days(7).map((d, i) => [d, 500 + i * 20]) };
  if (query.includes("AS sid")) return { columns: ["sid", "did", "start", "dur"], results: [["s-1", "user-1", new Date().toISOString(), 125]] };
  return { columns: ["x"], results: [] };
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", `http://127.0.0.1:${PORT}`);
  calls.push({ method: req.method ?? "GET", path: url.pathname });
  const send = (status: number, body: unknown) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (url.pathname === "/__calls") return send(200, calls);
  if (req.headers.authorization !== `Bearer ${MOCK_KEY}`) return send(401, { detail: "Invalid personal API key." });
  // connect mode must be read-only: the query endpoint is the only POST allowed
  if (req.method !== "GET" && !(req.method === "POST" && /^\/api\/projects\/\d+\/query\/$/.test(url.pathname))) return send(405, { detail: "fixture: write attempted" });
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    switch (true) {
      case url.pathname === "/api/users/@me/":
        return send(200, { email: "owner@example.test", organization: { id: "org-e2e", name: "E2E Org", teams: [] }, organizations: [{ id: "org-e2e", name: "E2E Org" }] });
      case url.pathname === "/api/organizations/org-e2e/projects/":
        return send(200, { count: 1, next: null, previous: null, results: [{ id: 4242, name: "E2E Web App", timezone: "America/Phoenix", api_token: MOCK_PROJECT_TOKEN }] });
      case url.pathname === "/api/projects/4242/event_definitions/":
        return send(200, { next: null, results: [{ name: "$pageview", volume_30_day: 1900 }, { name: "signed_up", volume_30_day: 141 }] });
      case url.pathname === "/api/projects/4242/session_recordings/":
        return send(403, { detail: "API key missing required scope 'session_recording:read'" });
      case url.pathname === "/api/projects/4242/insights/":
        return send(200, { results: [] });
      case url.pathname === "/api/projects/4242/query/": {
        const j = JSON.parse(body || "{}") as { query?: { kind?: string; query?: string; values?: Record<string, unknown> } };
        if (j.query?.kind !== "HogQLQuery") return send(400, { detail: "fixture expects HogQLQuery" });
        return send(200, { ...hogql(j.query.query ?? ""), is_cached: false });
      }
      default:
        return send(404, { detail: "Not found." });
    }
  });
});

server.listen(PORT, "127.0.0.1", () => console.log(`mock posthog on ${PORT}`));
