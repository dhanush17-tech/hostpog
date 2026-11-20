import type { ClickHouseClient } from "@clickhouse/client";
import {
  SqlProvider,
  ProviderError,
  fingerprint,
  type CompiledQuery,
  type ExecResult,
  type HealthReport,
  type QueryContext,
  type Run,
  type SessionSummary,
} from "@hostpog/analytics";
import type {
  CapabilityReport,
  Envelope,
  EventDefinition,
  PersonRow,
  PersonsQuery,
  PersonsResult,
  ResolvedRange,
  SourceRef,
} from "@hostpog/contracts";
import { nativePersonDistinctIds, nativePersons, type Db } from "@hostpog/db";
import { and, desc, eq, gte, ilike, lt, or, sql } from "drizzle-orm";
import { eventsBackend } from "./clickhouse";
import { distinctIdsFor } from "./identity";

export interface NativeProviderOpts {
  db: Db;
  ch: ClickHouseClient;
  /** storage partition id — the HostPog source id that owns the data */
  partitionId: string;
  sourceId: string;
  label?: string;
  timezone: string;
  kind?: "native" | "imported" | "demo";
}

export class NativeProvider extends SqlProvider {
  readonly source: SourceRef;
  protected readonly dialect = "clickhouse" as const;

  constructor(private readonly o: NativeProviderOpts) {
    super();
    this.source = { kind: o.kind ?? "native", sourceId: o.sourceId, label: o.label ?? "HostPog native" };
  }

  protected nativeProjectId() {
    return this.o.partitionId;
  }

  protected async timezone() {
    return this.o.timezone;
  }

  protected async execute(q: CompiledQuery, ctx?: QueryContext): Promise<ExecResult> {
    const started = Date.now();
    try {
      const rs = await this.o.ch.query({
        query: q.text,
        query_params: q.params,
        format: "JSONCompactEachRowWithNames",
        abort_signal: ctx?.signal,
        clickhouse_settings: { join_use_nulls: 0 },
      });
      const rows = (await rs.json()) as unknown[][];
      const [columns = [], ...data] = rows;
      return {
        rowset: { columns: columns as string[], rows: data },
        cached: false,
        dataAsOf: null,
        executed: { dialect: "clickhouse", text: q.text, params: { ...q.params, _durationMs: Date.now() - started } },
      };
    } catch (err) {
      if (ctx?.signal?.aborted) throw new ProviderError("cancelled", "query cancelled");
      throw new ProviderError("upstream", `ClickHouse query failed: ${(err as Error).message}`, { cause: err });
    }
  }

  protected async newPersons(range: ResolvedRange, prev: ResolvedRange, run: Run) {
    const q = sql`SELECT
      count(*) FILTER (WHERE created_at >= ${range.from} AND created_at < ${range.to})::int AS cur,
      count(*) FILTER (WHERE created_at >= ${prev.from} AND created_at < ${prev.to})::int AS prev
      FROM native_persons WHERE partition_id = ${this.o.partitionId}`;
    const rows = (await this.o.db.execute(q)) as unknown as { cur: number; prev: number }[];
    run.queries.push({
      dialect: "postgres",
      text: "SELECT count(*) FILTER (...) FROM native_persons WHERE partition_id = $1",
      params: { partition_id: this.o.partitionId },
    });
    return { cur: Number(rows[0]?.cur ?? 0), prev: Number(rows[0]?.prev ?? 0) };
  }

  async capabilities(): Promise<CapabilityReport> {
    return {
      supported: ["trends", "funnels", "retention", "persons", "events", "web", "sessions", "event_definitions"],
      unavailable: [
        { capability: "replay_playback", reason: "Native session replay is not built yet (roadmap, Gate E)." },
        { capability: "errors", reason: "Native error tracking is not built yet (roadmap, Gate E)." },
        { capability: "traces", reason: "LLM trace ingestion is not built yet (roadmap, Gate E)." },
        { capability: "flags", reason: "Feature flags are roadmap (Gate F)." },
        { capability: "experiments", reason: "Experiments are roadmap (Gate F)." },
        { capability: "saved_insights", reason: "Use HostPog insights; native has no upstream insights." },
      ],
    };
  }

  async health(): Promise<HealthReport> {
    const started = Date.now();
    try {
      await this.o.ch.ping();
      return { ok: true, checkedAt: new Date().toISOString(), latencyMs: Date.now() - started, message: eventsBackend() === "tinybird" ? "Tinybird reachable" : "ClickHouse reachable" };
    } catch (e) {
      return { ok: false, checkedAt: new Date().toISOString(), latencyMs: null, message: (e as Error).message };
    }
  }

  private env<T>(result: T, started: number, queries: Envelope<T>["queries"], fp: string): Envelope<T> {
    return {
      result,
      source: this.source,
      range: null,
      timezone: this.o.timezone,
      computedAt: new Date().toISOString(),
      dataAsOf: null,
      cached: false,
      approximation: null,
      warnings: [],
      fingerprint: fp,
      queries,
      durationMs: Date.now() - started,
    };
  }

  async listEventDefinitions(search?: string): Promise<Envelope<EventDefinition[]>> {
    const started = Date.now();
    const text = `SELECT event, count() AS c, max(timestamp) AS last_seen FROM events
      WHERE project_id = {project:String} AND timestamp >= now() - INTERVAL 30 DAY
      ${search ? "AND positionCaseInsensitive(event, {search:String}) > 0" : ""}
      GROUP BY event ORDER BY c DESC LIMIT 500`;
    const params: Record<string, string> = { project: this.o.partitionId, ...(search ? { search } : {}) };
    const rs = await this.o.ch.query({ query: text, query_params: params, format: "JSONEachRow" });
    const rows = (await rs.json()) as { event: string; c: string; last_seen: string }[];
    return this.env(
      rows.map((r) => ({ name: r.event, volume30d: Number(r.c), lastSeenAt: new Date(`${r.last_seen.replace(" ", "T")}Z`).toISOString() })),
      started,
      [{ dialect: "clickhouse", text, params }],
      fingerprint(this.source.sourceId, "defs", search ?? ""),
    );
  }

  async listPersons(q: PersonsQuery): Promise<Envelope<PersonsResult>> {
    const started = Date.now();
    const conds = [eq(nativePersons.partitionId, this.o.partitionId)];
    if (q.identified !== undefined) conds.push(eq(nativePersons.isIdentified, q.identified));
    if (q.search) {
      const term = `%${q.search.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      conds.push(
        or(
          ilike(sql`${nativePersons.properties}->>'email'`, term),
          ilike(sql`${nativePersons.properties}->>'name'`, term),
          sql`exists (select 1 from ${nativePersonDistinctIds} d where d.person_id = ${nativePersons.id} and d.distinct_id ilike ${term})`,
        )!,
      );
    }
    if (q.cursor) {
      const [ts, id] = q.cursor.split("|");
      if (ts && id) conds.push(or(lt(nativePersons.createdAt, new Date(ts)), and(eq(nativePersons.createdAt, new Date(ts)), lt(nativePersons.id, id)))!);
    }
    const rows = await this.o.db
      .select()
      .from(nativePersons)
      .where(and(...conds))
      .orderBy(desc(nativePersons.createdAt), desc(nativePersons.id))
      .limit(q.limit + 1);
    const page = rows.slice(0, q.limit);
    const ids = await distinctIdsFor(this.o.db, this.o.partitionId, page.map((p) => p.id));
    const last = page[page.length - 1];
    return this.env(
      {
        rows: page.map((p) => ({
          id: p.id,
          distinctIds: ids.get(p.id) ?? [],
          isIdentified: p.isIdentified,
          createdAt: p.createdAt.toISOString(),
          properties: p.properties,
        })),
        nextCursor: rows.length > q.limit && last ? `${last.createdAt.toISOString()}|${last.id}` : null,
      },
      started,
      [{ dialect: "postgres", text: "SELECT * FROM native_persons WHERE partition_id = $1 ... ORDER BY created_at DESC", params: { partition_id: this.o.partitionId } }],
      fingerprint(this.source.sourceId, q),
    );
  }

  async getPerson(id: string): Promise<Envelope<PersonRow | null>> {
    const started = Date.now();
    const uuidLike = /^[0-9a-f-]{36}$/i.test(id);
    let row = uuidLike
      ? (await this.o.db.select().from(nativePersons).where(and(eq(nativePersons.partitionId, this.o.partitionId), eq(nativePersons.id, id))).limit(1))[0]
      : undefined;
    if (!row) {
      const m = (
        await this.o.db
          .select()
          .from(nativePersonDistinctIds)
          .where(and(eq(nativePersonDistinctIds.partitionId, this.o.partitionId), eq(nativePersonDistinctIds.distinctId, id)))
          .limit(1)
      )[0];
      if (m) row = (await this.o.db.select().from(nativePersons).where(eq(nativePersons.id, m.personId)).limit(1))[0];
    }
    const ids = row ? await distinctIdsFor(this.o.db, this.o.partitionId, [row.id]) : new Map();
    return this.env(
      row
        ? { id: row.id, distinctIds: ids.get(row.id) ?? [], isIdentified: row.isIdentified, createdAt: row.createdAt.toISOString(), properties: row.properties }
        : null,
      started,
      [{ dialect: "postgres", text: "SELECT * FROM native_persons WHERE partition_id = $1 AND id = $2", params: { id } }],
      fingerprint(this.source.sourceId, "person", id),
    );
  }

  async listSessions(opts: { personId?: string; limit?: number }): Promise<Envelope<SessionSummary[]>> {
    const started = Date.now();
    const b = { project: this.o.partitionId, ...(opts.personId ? { person: opts.personId } : {}) };
    const text = `SELECT session_id, any(distinct_id) AS distinct_id, min(timestamp) AS start, dateDiff('second', min(timestamp), max(timestamp)) AS dur
      FROM events FINAL WHERE project_id = {project:String} AND session_id != '' AND timestamp >= now() - INTERVAL 30 DAY
      ${opts.personId ? `AND distinct_id IN (SELECT distinct_id FROM person_distinct_ids WHERE project_id = {project:String} GROUP BY distinct_id HAVING argMax(person_id, version) = {person:String})` : ""}
      GROUP BY session_id ORDER BY start DESC LIMIT ${Math.min(Math.trunc(opts.limit ?? 50), 200)}`;
    const rs = await this.o.ch.query({ query: text, query_params: b, format: "JSONEachRow" });
    const rows = (await rs.json()) as { session_id: string; distinct_id: string; start: string; dur: string }[];
    return this.env(
      rows.map((r) => ({
        sessionId: r.session_id,
        distinctId: r.distinct_id,
        startTime: new Date(`${r.start.replace(" ", "T")}Z`).toISOString(),
        durationSeconds: Number(r.dur),
      })),
      started,
      [{ dialect: "clickhouse", text, params: b }],
      fingerprint(this.source.sourceId, "sessions", opts),
    );
  }
}
