import {
  SqlProvider,
  ProviderError,
  compileHogqlNewPersons,
  fingerprint,
  objects,
  parseProps,
  SqlBuilder,
  strOrNull,
  toIso,
  num,
  type CompiledQuery,
  type ExecResult,
  type HealthReport,
  type QueryContext,
  type Run,
  type SessionSummary,
} from "@hostpog/analytics";
import type {
  Capability,
  CapabilityReport,
  Envelope,
  EventDefinition,
  ExecutedQuery,
  PersonRow,
  PersonsQuery,
  PersonsResult,
  ResolvedRange,
  SourceRef,
} from "@hostpog/contracts";
import { sharedCache, type CoalescingCache } from "./cache";
import type { PostHogClient } from "./client";

export interface PostHogProviderOpts {
  client: PostHogClient;
  /** HostPog tenant + source ids (cache namespace) */
  tenantKey: string;
  sourceId: string;
  label: string;
  region: string;
  externalProjectId: string;
  timezone: string;
  /** scopes we verified at connect time; null = unknown (treated optimistically) */
  verifiedScopes: string[] | null;
  cache?: CoalescingCache;
  cacheTtlMs?: number;
}

interface HogQLResponse {
  results: unknown[][];
  columns?: string[];
  types?: unknown[];
  is_cached?: boolean;
  last_refresh?: string | null;
  hasMore?: boolean;
  error?: string | null;
}

export class PostHogProvider extends SqlProvider {
  readonly source: SourceRef;
  protected readonly dialect = "hogql" as const;
  private readonly cache: CoalescingCache;

  constructor(private readonly o: PostHogProviderOpts) {
    super();
    this.cache = o.cache ?? sharedCache;
    this.source = {
      kind: "posthog",
      sourceId: o.sourceId,
      label: o.label,
      region: o.region,
      externalProjectId: o.externalProjectId,
    };
  }

  /** cache namespace — invalidate with `${tenantKey}:${sourceId}:` */
  get cachePrefix() {
    return `${this.o.tenantKey}:${this.o.sourceId}:`;
  }

  protected nativeProjectId() {
    return undefined;
  }

  protected async timezone() {
    return this.o.timezone;
  }

  private projectPath(suffix: string) {
    return `/api/projects/${encodeURIComponent(this.o.externalProjectId)}/${suffix}`;
  }

  /** Run a bounded HogQL query through the documented query endpoint. */
  async hogql(q: CompiledQuery, ctx?: QueryContext, name = "hostpog"): Promise<{ res: HogQLResponse; hit: boolean; executed: ExecutedQuery }> {
    const key = `${this.cachePrefix}${fingerprint(q.text, q.params)}`;
    const executed: ExecutedQuery = { dialect: "hogql", text: q.text, params: q.params };
    const { value, hit } = await this.cache.get(key, this.o.cacheTtlMs ?? 60_000, () =>
      this.o.client.request<HogQLResponse>(this.projectPath("query/"), {
        method: "POST",
        category: "query",
        signal: ctx?.signal,
        body: {
          query: { kind: "HogQLQuery", query: q.text, values: q.params },
          name: `hostpog:${name}`,
        },
      }),
    );
    if (value.error) throw new ProviderError("bad_query", value.error);
    return { res: value, hit, executed };
  }

  protected async execute(q: CompiledQuery, ctx?: QueryContext): Promise<ExecResult> {
    const { res, hit, executed } = await this.hogql(q, ctx);
    const columns = res.columns ?? [];
    if (!columns.length && res.results.length) {
      throw new ProviderError("upstream", "PostHog query response did not include column names");
    }
    return {
      rowset: { columns, rows: res.results ?? [] },
      cached: hit || Boolean(res.is_cached),
      dataAsOf: res.is_cached && res.last_refresh ? new Date(res.last_refresh).toISOString() : null,
      executed,
    };
  }

  protected async newPersons(range: ResolvedRange, prev: ResolvedRange, run: Run, ctx?: QueryContext) {
    try {
      const rs = await this.run(compileHogqlNewPersons(range, prev), run, ctx);
      const [r] = objects(rs);
      return { cur: num(r?.cur), prev: num(r?.prev) };
    } catch (e) {
      if (e instanceof ProviderError && (e.code === "forbidden" || e.code === "bad_query")) {
        run.warnings.push("New users unavailable: could not read person profiles from PostHog with this credential.");
        return null;
      }
      throw e;
    }
  }

  private has(scope: string): boolean {
    return this.o.verifiedScopes === null || this.o.verifiedScopes.includes(scope);
  }

  async capabilities(): Promise<CapabilityReport> {
    const supported: Capability[] = [];
    const unavailable: CapabilityReport["unavailable"] = [];
    const gate = (c: Capability, scope: string) =>
      this.has(scope) ? supported.push(c) : unavailable.push({ capability: c, reason: `credential lacks ${scope}` });
    for (const c of ["trends", "funnels", "retention", "events", "web", "sessions"] as Capability[]) gate(c, "query:read");
    gate("persons", "query:read");
    gate("event_definitions", "event_definition:read");
    gate("replay_metadata", "session_recording:read");
    gate("saved_insights", "insight:read");
    unavailable.push(
      { capability: "replay_playback", reason: "Embedded playback is not implemented; recordings open in PostHog." },
      { capability: "errors", reason: "PostHog error tracking is not integrated yet." },
      { capability: "traces", reason: "PostHog LLM traces are not integrated yet." },
      { capability: "flags", reason: "Flags stay authoritative in PostHog; read-only view not built yet." },
      { capability: "experiments", reason: "Experiments stay authoritative in PostHog; read-only view not built yet." },
    );
    return { supported, unavailable };
  }

  async health(ctx?: QueryContext): Promise<HealthReport> {
    const started = Date.now();
    try {
      await this.o.client.request(this.projectPath("event_definitions/"), { query: { limit: 1 }, signal: ctx?.signal });
      return { ok: true, checkedAt: new Date().toISOString(), latencyMs: Date.now() - started, message: "PostHog reachable" };
    } catch (e) {
      const pe = e instanceof ProviderError ? e : new ProviderError("upstream", String(e));
      return {
        ok: pe.code === "forbidden", // reachable but scope-limited
        checkedAt: new Date().toISOString(),
        latencyMs: null,
        message: pe.message,
        ...(pe.missingScope ? { missingScopes: [pe.missingScope] } : {}),
      };
    }
  }

  private env<T>(result: T, started: number, queries: ExecutedQuery[], cached: boolean, fp: string, warnings: string[] = []): Envelope<T> {
    return {
      result,
      source: this.source,
      range: null,
      timezone: this.o.timezone,
      computedAt: new Date().toISOString(),
      dataAsOf: null,
      cached,
      approximation: null,
      warnings,
      fingerprint: fp,
      queries,
      durationMs: Date.now() - started,
    };
  }

  async listEventDefinitions(search?: string, ctx?: QueryContext): Promise<Envelope<EventDefinition[]>> {
    const started = Date.now();
    const query = { limit: 200, ...(search ? { search } : {}) };
    const key = `${this.cachePrefix}defs:${search ?? ""}`;
    const { value, hit } = await this.cache.get(key, 5 * 60_000, () =>
      this.o.client.request<{ results: { name: string; volume_30_day?: number | null; last_seen_at?: string | null }[] }>(
        this.projectPath("event_definitions/"),
        { query, signal: ctx?.signal },
      ),
    );
    return this.env(
      value.results.map((d) => ({ name: d.name, volume30d: d.volume_30_day ?? null, lastSeenAt: d.last_seen_at ?? null })),
      started,
      [{ dialect: "posthog-rest", text: `GET ${this.projectPath("event_definitions/")}`, params: query }],
      hit,
      fingerprint(this.o.sourceId, "defs", search ?? ""),
    );
  }

  private async distinctIds(personIds: string[], ctx?: QueryContext) {
    if (!personIds.length) return { map: new Map<string, string[]>(), executed: null as ExecutedQuery | null, hit: false };
    const b = new SqlBuilder("hogql", { timezone: this.o.timezone });
    const list = personIds.map((id) => b.p(id)).join(", ");
    const q = b.build(`SELECT toString(person_id) AS pid, groupArray(distinct_id) AS ids FROM person_distinct_ids WHERE toString(person_id) IN (${list}) GROUP BY pid LIMIT 500`);
    const { res, executed, hit } = await this.hogql(q, ctx, "distinct_ids");
    const map = new Map<string, string[]>();
    for (const r of objects({ columns: res.columns ?? [], rows: res.results })) {
      map.set(String(r.pid), Array.isArray(r.ids) ? (r.ids as string[]).slice(0, 50) : []);
    }
    return { map, executed, hit };
  }

  private toPerson(r: Record<string, unknown>, ids: Map<string, string[]>): PersonRow {
    const id = String(r.id);
    return {
      id,
      distinctIds: ids.get(id) ?? [],
      isIdentified: r.is_identified === true || r.is_identified === 1 || r.is_identified === "true",
      createdAt: r.created_at ? toIso(r.created_at) : null,
      properties: parseProps(r.properties),
    };
  }

  async listPersons(q: PersonsQuery, ctx?: QueryContext): Promise<Envelope<PersonsResult>> {
    const started = Date.now();
    const b = new SqlBuilder("hogql", { timezone: this.o.timezone });
    const conds: string[] = [];
    if (q.identified !== undefined) conds.push(`is_identified = ${q.identified ? "true" : "false"}`);
    if (q.search) {
      const t = b.p(q.search);
      conds.push(
        `(positionCaseInsensitive(toString(properties.email), ${t}) > 0 OR positionCaseInsensitive(toString(properties.name), ${t}) > 0 OR toString(id) = ${t})`,
      );
    }
    if (q.cursor) {
      const [ts, id] = q.cursor.split("|");
      if (ts && id) {
        const d = b.dt(ts);
        conds.push(`(created_at < ${d} OR (created_at = ${d} AND toString(id) < ${b.p(id)}))`);
      }
    }
    const cq = b.build(`SELECT toString(id) AS id, created_at, is_identified, properties FROM persons
${conds.length ? `WHERE ${conds.join(" AND ")}` : ""}
ORDER BY created_at DESC, id DESC
LIMIT ${q.limit + 1}`);
    const { res, executed, hit } = await this.hogql(cq, ctx, "persons");
    const rows = objects({ columns: res.columns ?? [], rows: res.results });
    const page = rows.slice(0, q.limit);
    const ids = await this.distinctIds(page.map((r) => String(r.id)), ctx);
    const persons = page.map((r) => this.toPerson(r, ids.map));
    const last = persons[persons.length - 1];
    return this.env(
      { rows: persons, nextCursor: rows.length > q.limit && last?.createdAt ? `${last.createdAt}|${last.id}` : null },
      started,
      [executed, ...(ids.executed ? [ids.executed] : [])],
      hit,
      fingerprint(this.o.sourceId, q),
    );
  }

  async getPerson(id: string, ctx?: QueryContext): Promise<Envelope<PersonRow | null>> {
    const started = Date.now();
    const b = new SqlBuilder("hogql", { timezone: this.o.timezone });
    const v = b.p(id);
    const cq = b.build(`SELECT toString(id) AS id, created_at, is_identified, properties FROM persons
WHERE toString(id) = ${v} OR toString(id) IN (SELECT toString(person_id) FROM person_distinct_ids WHERE distinct_id = ${v})
LIMIT 1`);
    const { res, executed, hit } = await this.hogql(cq, ctx, "person");
    const [r] = objects({ columns: res.columns ?? [], rows: res.results });
    if (!r) return this.env(null, started, [executed], hit, fingerprint(this.o.sourceId, "person", id));
    const ids = await this.distinctIds([String(r.id)], ctx);
    return this.env(this.toPerson(r, ids.map), started, [executed, ...(ids.executed ? [ids.executed] : [])], hit, fingerprint(this.o.sourceId, "person", id));
  }

  async listSessions(opts: { personId?: string; limit?: number }, ctx?: QueryContext): Promise<Envelope<SessionSummary[]>> {
    const started = Date.now();
    const b = new SqlBuilder("hogql", { timezone: this.o.timezone });
    const conds = [`e.timestamp >= now() - INTERVAL 30 DAY`, `e.properties['$session_id'] IS NOT NULL`];
    if (opts.personId) conds.push(`toString(e.person_id) = ${b.p(opts.personId)}`);
    const cq = b.build(`SELECT toString(e.properties['$session_id']) AS sid, any(e.distinct_id) AS did, min(e.timestamp) AS start,
       dateDiff('second', min(e.timestamp), max(e.timestamp)) AS dur
FROM events AS e
WHERE ${conds.join(" AND ")}
GROUP BY sid ORDER BY start DESC LIMIT ${Math.min(Math.trunc(opts.limit ?? 50), 200)}`);
    const { res, executed, hit } = await this.hogql(cq, ctx, "sessions");
    const host = this.o.client.host;
    const replay = this.has("session_recording:read");
    return this.env(
      objects({ columns: res.columns ?? [], rows: res.results }).map((r) => ({
        sessionId: String(r.sid),
        distinctId: strOrNull(r.did),
        startTime: toIso(r.start),
        durationSeconds: num(r.dur),
        // PostHog enforces its own authorization on this link; it opens only for users who can see the recording.
        ...(replay ? { externalUrl: `${host}/project/${encodeURIComponent(this.o.externalProjectId)}/replay/${encodeURIComponent(String(r.sid))}` } : {}),
      })),
      started,
      [executed],
      hit,
      fingerprint(this.o.sourceId, "sessions", opts),
      replay ? [] : ["Replay links hidden: credential lacks session_recording:read."],
    );
  }
}
