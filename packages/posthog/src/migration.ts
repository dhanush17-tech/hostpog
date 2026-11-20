/**
 * Read-only helpers for moving a project off PostHog:
 *  - productUsage(): which PostHog products the project actually uses (gap check)
 *  - estimateHistory() / exportEventsPage() / exportPersonsPage(): bounded, keyset-paged
 *    export of history through the documented query endpoint, for small projects.
 *    Large projects must use a PostHog batch export instead (see docs/posthog-contract.md).
 */
import { ProviderError, SqlBuilder, objects, parseProps, toIso, num } from "@hostpog/analytics";
import type { ProductUsageReport } from "@hostpog/db";
import type { PostHogClient } from "./client";

interface HogQLResponse {
  results: unknown[][];
  columns?: string[];
  error?: string | null;
}

async function hogql(client: PostHogClient, projectId: string, q: { text: string; params: Record<string, string | number> }, name: string, signal?: AbortSignal) {
  const res = await client.request<HogQLResponse>(`/api/projects/${encodeURIComponent(projectId)}/query/`, {
    method: "POST",
    category: "query",
    signal,
    // refresh=blocking without HostPog caching: imports need current data
    body: { query: { kind: "HogQLQuery", query: q.text, values: q.params }, name: `hostpog:${name}`, refresh: "blocking" },
  });
  if (res.error) throw new ProviderError("bad_query", res.error);
  return objects({ columns: res.columns ?? [], rows: res.results ?? [] });
}

async function probe(client: PostHogClient, path: string, signal?: AbortSignal): Promise<{ ok: boolean; count: number | null; detail: string }> {
  try {
    const r = await client.request<{ count?: number; results?: unknown[] }>(path, { query: { limit: 1 }, category: "analytics", signal });
    return { ok: true, count: typeof r.count === "number" ? r.count : (r.results?.length ?? 0), detail: "" };
  } catch (e) {
    if (e instanceof ProviderError && (e.code === "forbidden" || e.code === "not_found")) return { ok: false, count: null, detail: e.message };
    throw e;
  }
}

/** Which PostHog products does this project use? Read-only; uses events + list endpoints. */
export async function productUsage(client: PostHogClient, projectId: string, windowDays = 30, signal?: AbortSignal): Promise<ProductUsageReport> {
  const b = new SqlBuilder("hogql", { timezone: "UTC" });
  const since = b.dt(new Date(Date.now() - windowDays * 86400_000).toISOString());
  const q = b.build(`SELECT
    count() AS total,
    countIf(event = '$feature_flag_called') AS flag_calls,
    uniqIf(toString(properties['$feature_flag']), event = '$feature_flag_called') AS flag_keys,
    countIf(event = '$exception') AS exceptions,
    countIf(event IN ('survey shown', 'survey sent', 'survey dismissed')) AS survey_events,
    countIf(event IN ('$ai_generation', '$ai_trace', '$ai_span', '$ai_embedding')) AS ai_events,
    countIf(event = '$groupidentify') AS group_events,
    countIf(properties['$session_id'] IS NOT NULL) AS session_events
  FROM events WHERE timestamp >= ${since}`);
  const [r] = await hogql(client, projectId, q, "product-usage", signal);
  const p = (s: string) => `/api/projects/${encodeURIComponent(projectId)}/${s}`;
  const [recordings, flags, experiments, surveys, insights, dashboards] = await Promise.all([
    probe(client, p("session_recordings/"), signal),
    probe(client, p("feature_flags/"), signal),
    probe(client, p("experiments/"), signal),
    probe(client, p("surveys/"), signal),
    probe(client, p("insights/"), signal),
    probe(client, p("dashboards/"), signal),
  ]);
  const n = (k: string) => num(r?.[k]);
  const unknown = (x: { ok: boolean; detail: string }) => (x.ok ? "" : ` (could not check: ${x.detail})`);
  const products: ProductUsageReport["products"] = [
    {
      key: "product_analytics",
      label: "Product analytics (events, trends, funnels, retention)",
      inUse: n("total") > 0,
      detail: `${n("total").toLocaleString()} events in the last ${windowDays} days`,
      hostpogSupport: "supported",
      blocksCutover: false,
    },
    {
      key: "feature_flags",
      label: "Feature flags",
      inUse: n("flag_calls") > 0 || (flags.ok ? (flags.count ?? 0) > 0 : null),
      detail: `${n("flag_calls").toLocaleString()} flag evaluations (${n("flag_keys")} flags) in ${windowDays} days${flags.ok ? `; ${flags.count} flags defined` : unknown(flags)}`,
      hostpogSupport: "not_yet",
      blocksCutover: true,
    },
    {
      key: "experiments",
      label: "Experiments",
      inUse: experiments.ok ? (experiments.count ?? 0) > 0 : null,
      detail: experiments.ok ? `${experiments.count} experiments defined` : `unknown${unknown(experiments)}`,
      hostpogSupport: "not_yet",
      blocksCutover: true,
    },
    {
      key: "session_replay",
      label: "Session replay",
      inUse: recordings.ok ? (recordings.count ?? 0) > 0 : null,
      detail: recordings.ok ? `${recordings.count} recordings stored in PostHog` : `unknown${unknown(recordings)}`,
      hostpogSupport: "not_yet",
      blocksCutover: true,
    },
    {
      key: "surveys",
      label: "Surveys",
      inUse: n("survey_events") > 0 || (surveys.ok ? (surveys.count ?? 0) > 0 : null),
      detail: `${n("survey_events")} survey events${surveys.ok ? `; ${surveys.count} surveys defined` : unknown(surveys)}`,
      hostpogSupport: "not_yet",
      blocksCutover: true,
    },
    {
      key: "error_tracking",
      label: "Error tracking",
      inUse: n("exceptions") > 0,
      detail: `${n("exceptions").toLocaleString()} $exception events — HostPog keeps them as events, but has no error grouping UI yet`,
      hostpogSupport: "not_yet",
      blocksCutover: false,
    },
    {
      key: "llm_analytics",
      label: "LLM analytics",
      inUse: n("ai_events") > 0,
      detail: `${n("ai_events").toLocaleString()} $ai_* events — kept as events, no trace UI yet`,
      hostpogSupport: "not_yet",
      blocksCutover: false,
    },
    {
      key: "group_analytics",
      label: "Group analytics",
      inUse: n("group_events") > 0,
      detail: `${n("group_events")} $groupidentify events — kept as events, groups are not modelled yet`,
      hostpogSupport: "not_yet",
      blocksCutover: false,
    },
    {
      key: "saved_insights",
      label: "Saved insights and dashboards",
      inUse: insights.ok || dashboards.ok ? (insights.count ?? 0) + (dashboards.count ?? 0) > 0 : null,
      detail: `${insights.ok ? `${insights.count} insights` : "insights unknown"}, ${dashboards.ok ? `${dashboards.count} dashboards` : "dashboards unknown"} — recreate the ones you need in HostPog`,
      hostpogSupport: "manual",
      blocksCutover: false,
    },
  ];
  return { checkedAt: new Date().toISOString(), windowDays, products };
}

export async function estimateHistory(client: PostHogClient, projectId: string, from: string, to: string, signal?: AbortSignal) {
  const b = new SqlBuilder("hogql", { timezone: "UTC" });
  const q = b.build(`SELECT count() AS events, min(timestamp) AS first_ts, max(timestamp) AS last_ts FROM events WHERE timestamp >= ${b.dt(from)} AND timestamp < ${b.dt(to)}`);
  const [r] = await hogql(client, projectId, q, "import-estimate", signal);
  const pb = new SqlBuilder("hogql", { timezone: "UTC" });
  const [pr] = await hogql(client, projectId, pb.build("SELECT count() AS persons FROM persons"), "import-estimate-persons", signal).catch(() => [undefined]);
  return {
    events: num(r?.events),
    persons: pr ? num(pr.persons) : null,
    firstEventAt: r?.first_ts && num(r.events) ? toIso(r.first_ts) : null,
    lastEventAt: r?.last_ts && num(r.events) ? toIso(r.last_ts) : null,
  };
}

export interface ExportedEvent {
  uuid: string;
  event: string;
  distinct_id: string;
  timestamp: string;
  properties: Record<string, unknown>;
}

/** One keyset page ordered by (timestamp ms, uuid). Returns the next cursor or null when done. */
export async function exportEventsPage(
  client: PostHogClient,
  projectId: string,
  opts: { from: string; to: string; afterMs?: number; afterUuid?: string; limit: number; signal?: AbortSignal },
): Promise<{ events: ExportedEvent[]; next: { afterMs: number; afterUuid: string } | null }> {
  const b = new SqlBuilder("hogql", { timezone: "UTC" });
  const conds = [`timestamp >= ${b.dt(opts.from)}`, `timestamp < ${b.dt(opts.to)}`];
  if (opts.afterMs !== undefined && opts.afterUuid) {
    const ms = b.p(opts.afterMs);
    conds.push(`(toUnixTimestamp64Milli(timestamp) > ${ms} OR (toUnixTimestamp64Milli(timestamp) = ${ms} AND toString(uuid) > ${b.p(opts.afterUuid)}))`);
  }
  const q = b.build(`SELECT toString(uuid) AS uuid, event, distinct_id, toUnixTimestamp64Milli(timestamp) AS ts_ms, properties
FROM events
WHERE ${conds.join(" AND ")}
ORDER BY ts_ms ASC, uuid ASC
LIMIT ${Math.trunc(opts.limit)}`);
  const rows = await hogql(client, projectId, q, "import-events", opts.signal);
  const events = rows.map((r) => ({
    uuid: String(r.uuid),
    event: String(r.event),
    distinct_id: String(r.distinct_id),
    timestamp: new Date(num(r.ts_ms)).toISOString(),
    properties: parseProps(r.properties),
  }));
  const last = rows[rows.length - 1];
  return { events, next: rows.length === opts.limit && last ? { afterMs: num(last.ts_ms), afterUuid: String(last.uuid) } : null };
}

export interface ExportedPerson {
  id: string;
  createdAt: string | null;
  isIdentified: boolean;
  properties: Record<string, unknown>;
  distinctIds: string[];
}

export async function exportPersonsPage(
  client: PostHogClient,
  projectId: string,
  opts: { afterId?: string; limit: number; signal?: AbortSignal },
): Promise<{ persons: ExportedPerson[]; next: string | null }> {
  const b = new SqlBuilder("hogql", { timezone: "UTC" });
  const cond = opts.afterId ? `WHERE toString(id) > ${b.p(opts.afterId)}` : "";
  const rows = await hogql(
    client,
    projectId,
    b.build(`SELECT toString(id) AS id, created_at, is_identified, properties FROM persons ${cond} ORDER BY id ASC LIMIT ${Math.trunc(opts.limit)}`),
    "import-persons",
    opts.signal,
  );
  if (!rows.length) return { persons: [], next: null };
  const db = new SqlBuilder("hogql", { timezone: "UTC" });
  const ids = rows.map((r) => db.p(String(r.id))).join(", ");
  const dRows = await hogql(
    client,
    projectId,
    db.build(`SELECT toString(person_id) AS pid, groupArray(distinct_id) AS ids FROM person_distinct_ids WHERE toString(person_id) IN (${ids}) GROUP BY pid LIMIT ${rows.length}`),
    "import-person-ids",
    opts.signal,
  );
  const map = new Map(dRows.map((r) => [String(r.pid), Array.isArray(r.ids) ? (r.ids as unknown[]).map(String) : []]));
  const persons = rows.map((r) => ({
    id: String(r.id),
    createdAt: r.created_at ? toIso(r.created_at) : null,
    isIdentified: r.is_identified === true || r.is_identified === 1 || r.is_identified === "true",
    properties: parseProps(r.properties),
    distinctIds: map.get(String(r.id)) ?? [],
  }));
  return { persons, next: rows.length === opts.limit ? persons[persons.length - 1]!.id : null };
}

export const API_IMPORT_MAX_EVENTS = () => Number(process.env.HOSTPOG_API_IMPORT_MAX_EVENTS ?? 1_000_000);
