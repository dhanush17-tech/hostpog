/**
 * Opt-in, read-only live smoke test against a real PostHog project.
 *
 *   POSTHOG_SMOKE_API_KEY=phx_... POSTHOG_SMOKE_REGION=us [POSTHOG_SMOKE_PROJECT_ID=123] pnpm posthog:smoke
 *
 * It discovers projects, probes scopes and runs one summary, trend, funnel,
 * events and persons query. It never writes to PostHog. Results are printed as
 * counts only (no person properties).
 */
import { PostHogClient } from "../src/client";
import { discoverProjects, probeScopes } from "../src/discovery";
import { resolvePostHogHost, type PostHogRegion } from "../src/hosts";
import { PostHogProvider } from "../src/provider";

const key = process.env.POSTHOG_SMOKE_API_KEY;
if (!key) {
  console.error("Set POSTHOG_SMOKE_API_KEY (a personal API key for a test project).");
  process.exit(2);
}
// Region: POSTHOG_SMOKE_REGION, or auto-detect by trying US then EU.
let region = (process.env.POSTHOG_SMOKE_REGION ?? "") as PostHogRegion | "";
if (!region) {
  for (const r of ["us", "eu"] as const) {
    const res = await fetch(`${resolvePostHogHost(r)}/api/users/@me/`, { headers: { Authorization: `Bearer ${key}` } }).catch((e: Error) => {
      console.log(`✘ could not reach ${r} cloud: ${e.message}`);
      return null;
    });
    if (res && res.status !== 401) {
      region = r;
      break;
    }
  }
  if (!region) {
    console.error("The key was rejected by both US and EU Cloud (or neither was reachable). Set POSTHOG_SMOKE_REGION / POSTHOG_SMOKE_HOST for self-hosted.");
    process.exit(1);
  }
  console.log(`✔ detected region: ${region}`);
}
const host = resolvePostHogHost(region as PostHogRegion, process.env.POSTHOG_SMOKE_HOST);
const client = new PostHogClient({ host, auth: { type: "api_key", key }, credentialKey: "smoke" });

const step = async <T>(name: string, fn: () => Promise<T>): Promise<T | undefined> => {
  const t = Date.now();
  try {
    const v = await fn();
    console.log(`✔ ${name} (${Date.now() - t} ms)`);
    return v;
  } catch (e) {
    console.log(`✘ ${name}: ${(e as Error).message}`);
    return undefined;
  }
};

const disc = await step("discover projects", () => discoverProjects(client));
disc?.warnings.forEach((w) => console.log(`  ! ${w}`));
disc?.projects.forEach((p) => console.log(`  - ${p.id} ${p.name} (${p.timezone})`));
const projectId = process.env.POSTHOG_SMOKE_PROJECT_ID ?? disc?.projects[0]?.id;
if (!projectId) {
  console.error("No project found; set POSTHOG_SMOKE_PROJECT_ID.");
  process.exit(1);
}
const tz = disc?.projects.find((p) => p.id === projectId)?.timezone ?? "UTC";
const scopes = await step("probe scopes", () => probeScopes(client, projectId));
scopes?.forEach((s) => console.log(`  ${s.ok ? "ok " : "no "} ${s.scope}${s.ok ? "" : ` — ${s.detail}`}`));

const provider = new PostHogProvider({
  client,
  tenantKey: "smoke",
  sourceId: "smoke",
  label: "PostHog smoke",
  region,
  externalProjectId: projectId,
  timezone: tz,
  verifiedScopes: scopes ? scopes.filter((s) => s.ok).map((s) => s.scope) : null,
});

const summary = await step("summary (7d)", () => provider.query({ kind: "summary", dateRange: { from: "-7d", to: "now" } }));
if (summary) console.log(`  events=${summary.result.events} users=${summary.result.uniqueUsers} new=${summary.result.newUsers}`);
const defs = await step("event definitions", () => provider.listEventDefinitions());
const top = defs?.result.slice(0, 2).map((d) => d.name) ?? ["$pageview"];
const trend = await step("trend (7d, day)", () =>
  provider.query({ kind: "trend", series: [{ event: top[0] ?? "$pageview", math: "total", filters: [] }], interval: "day", dateRange: { from: "-7d", to: "now" }, compare: false, filters: [] }),
);
if (trend) console.log(`  ${trend.result.series[0]?.label}: ${trend.result.series[0]?.points.map((p) => p.v).join(", ")}`);
if (top.length >= 2) {
  const funnel = await step("funnel (30d)", () =>
    provider.query({ kind: "funnel", steps: top.map((e) => ({ event: e, filters: [] })), windowSeconds: 14 * 86400, dateRange: { from: "-30d", to: "now" }, filters: [] }),
  );
  if (funnel) console.log(`  ${funnel.result.steps.map((s) => `${s.event}=${s.count}`).join(" → ")}`);
}
const events = await step("events (24h)", () => provider.query({ kind: "events", dateRange: { from: "-24h", to: "now" }, limit: 5, filters: [] }));
if (events) console.log(`  ${events.result.rows.length} rows, next cursor: ${events.result.nextCursor ? "yes" : "no"}`);
const persons = await step("persons", () => provider.listPersons({ kind: "persons", limit: 5 }));
if (persons) console.log(`  ${persons.result.rows.length} persons`);
await step("web stats (7d)", () => provider.query({ kind: "web", dateRange: { from: "-7d", to: "now" } }));
