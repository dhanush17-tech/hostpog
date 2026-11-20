import type {
  AnalyticsQuery,
  CapabilityReport,
  Envelope,
  EventDefinition,
  EventsListQuery,
  EventsResult,
  ExecutedQuery,
  FunnelQuery,
  FunnelResult,
  PersonRow,
  PersonsQuery,
  PersonsResult,
  ResolvedRange,
  ResultFor,
  RetentionQuery,
  RetentionResult,
  SourceRef,
  SummaryResult,
  TopValuesQuery,
  TopValuesResult,
  TrendQuery,
  TrendResult,
  WebStatsResult,
} from "@hostpog/contracts";
import { AnalyticsQuery as AnalyticsQuerySchema } from "@hostpog/contracts";
import {
  compileEvents,
  compileFunnel,
  compileFunnelPersons,
  compileRetention,
  compileRetentionCohorts,
  compileSummary,
  compileTop,
  compileTrendSeries,
  compileWebSessions,
  compileWebTotals,
  type CompileOpts,
  type CompiledQuery,
  type DialectName,
} from "./compiler";
import { fingerprint } from "./fingerprint";
import type { AnalyticsProvider, HealthReport, QueryContext, SessionSummary } from "./provider";
import { previousRange, resolveRange } from "./range";
import {
  bucketLabels,
  num,
  objects,
  parseProps,
  shapeFunnel,
  shapeTrend,
  strOrNull,
  toIso,
  type RowSet,
} from "./shape";

export interface ExecResult {
  rowset: RowSet;
  cached: boolean;
  dataAsOf: string | null;
  executed: ExecutedQuery;
}

interface Run {
  queries: ExecutedQuery[];
  cached: boolean;
  dataAsOf: string | null;
  warnings: string[];
}

/**
 * Shared implementation for any provider whose analytics can be expressed in
 * the HostPog SQL compiler (PostHog via HogQL, native via ClickHouse).
 */
export abstract class SqlProvider implements AnalyticsProvider {
  abstract readonly source: SourceRef;
  protected abstract readonly dialect: DialectName;
  protected abstract timezone(ctx?: QueryContext): Promise<string>;
  protected abstract execute(q: CompiledQuery, ctx?: QueryContext): Promise<ExecResult>;
  /** null when the provider cannot determine person creation time */
  protected abstract newPersons(
    range: ResolvedRange,
    prev: ResolvedRange,
    run: Run,
    ctx?: QueryContext,
  ): Promise<{ cur: number; prev: number } | null>;
  protected abstract nativeProjectId(): string | undefined;

  abstract capabilities(): Promise<CapabilityReport>;
  abstract health(ctx?: QueryContext): Promise<HealthReport>;
  abstract listEventDefinitions(search?: string, ctx?: QueryContext): Promise<Envelope<EventDefinition[]>>;
  abstract listPersons(q: PersonsQuery, ctx?: QueryContext): Promise<Envelope<PersonsResult>>;
  abstract getPerson(id: string, ctx?: QueryContext): Promise<Envelope<PersonRow | null>>;
  abstract listSessions(
    opts: { personId?: string; limit?: number },
    ctx?: QueryContext,
  ): Promise<Envelope<SessionSummary[]>>;

  protected async run(q: CompiledQuery, run: Run, ctx?: QueryContext): Promise<RowSet> {
    const res = await this.execute(q, ctx);
    run.queries.push(res.executed);
    run.cached = run.cached || res.cached;
    if (res.dataAsOf && (!run.dataAsOf || res.dataAsOf < run.dataAsOf)) run.dataAsOf = res.dataAsOf;
    return res.rowset;
  }

  protected envelope<T>(
    result: T,
    run: Run,
    range: ResolvedRange | null,
    tz: string,
    started: number,
    fp: string,
    approximation: string | null = null,
  ): Envelope<T> {
    return {
      result,
      source: this.source,
      range,
      timezone: tz,
      computedAt: new Date().toISOString(),
      dataAsOf: run.dataAsOf,
      cached: run.cached,
      approximation,
      warnings: run.warnings,
      fingerprint: fp,
      queries: run.queries,
      durationMs: Date.now() - started,
    };
  }

  async query<Q extends AnalyticsQuery>(input: Q, ctx?: QueryContext): Promise<Envelope<ResultFor<Q>>> {
    const q = AnalyticsQuerySchema.parse(input) as AnalyticsQuery;
    const started = Date.now();
    const tz = ctx?.timezone ?? (await this.timezone(ctx));
    const o: CompileOpts = { dialect: this.dialect, projectId: this.nativeProjectId(), timezone: tz };
    const run: Run = { queries: [], cached: false, dataAsOf: null, warnings: [] };
    const fp = fingerprint(this.source.sourceId, q, tz);
    const range = resolveRange(q.dateRange, new Date(), tz);
    let result: unknown;
    let approx: string | null = null;

    switch (q.kind) {
      case "trend":
        result = await this.trend(q, range, o, run, ctx);
        break;
      case "funnel":
        result = shapeFunnel(await this.run(compileFunnel(q, range, o), run, ctx), q);
        approx =
          "Median time to convert uses first occurrences of the first and last step among full converters; treat it as approximate.";
        break;
      case "funnel_persons": {
        const rows = objects(await this.run(compileFunnelPersons(q, range, o), run, ctx));
        result = {
          persons: rows.map((r) => ({ personId: String(r.person_id), stepsCompleted: num(r.level) })),
          definition:
            q.outcome === "reached"
              ? `Persons who completed at least step ${q.step} (${q.steps[q.step - 1]?.event}) within the window.`
              : `Persons who completed step ${q.step - 1} but not step ${q.step} (${q.steps[q.step - 1]?.event}).`,
        };
        break;
      }
      case "events":
        result = await this.events(q, range, o, run, ctx);
        break;
      case "top":
        result = await this.top(q, range, o, run, ctx);
        break;
      case "summary":
        result = await this.summary(range, o, run, ctx);
        break;
      case "web":
        result = await this.web(range, o, run, ctx);
        break;
      case "retention":
        result = await this.retention(q, range, o, run, ctx);
        break;
    }
    return this.envelope(result as ResultFor<Q>, run, range, tz, started, fp, approx);
  }

  private async trend(q: TrendQuery, range: ResolvedRange, o: CompileOpts, run: Run, ctx?: QueryContext) {
    const labels = bucketLabels(range, q.interval, o.timezone);
    const exec = async (r: ResolvedRange, lbls: string[]) => {
      const out = [];
      for (const [i, s] of q.series.entries()) {
        const rs = await this.run(compileTrendSeries(s, q.filters, q.interval, r, q.breakdown, o), run, ctx);
        out.push(...shapeTrend(rs, s, i, lbls, q.interval, q.breakdown ? q.breakdown.limit : null));
      }
      return out;
    };
    const result: TrendResult = { interval: q.interval, series: await exec(range, labels) };
    if (q.compare) {
      const prev = previousRange(range);
      result.previous = await exec(prev, bucketLabels(prev, q.interval, o.timezone));
    }
    if (q.series.some((s) => s.math !== "total") && q.interval !== "hour") {
      run.warnings.push("Unique-user values are counted per bucket; they cannot be summed across buckets.");
    }
    return result;
  }

  private async events(q: EventsListQuery, range: ResolvedRange, o: CompileOpts, run: Run, ctx?: QueryContext) {
    const rows = objects(await this.run(compileEvents(q, range, o), run, ctx));
    const mapped = rows.map((r) => ({
      uuid: String(r.uuid),
      event: String(r.event),
      distinctId: String(r.distinct_id),
      personId: strOrNull(r.person_id),
      timestamp: toIso(r.timestamp),
      sessionId: strOrNull(r.session_id),
      properties: parseProps(r.properties),
    }));
    const hasMore = mapped.length > q.limit;
    const page = mapped.slice(0, q.limit);
    const last = page[page.length - 1];
    const result: EventsResult = { rows: page, nextCursor: hasMore && last ? { ts: last.timestamp, uuid: last.uuid } : null };
    return result;
  }

  private async top(q: TopValuesQuery, range: ResolvedRange, o: CompileOpts, run: Run, ctx?: QueryContext) {
    const rows = objects(await this.run(compileTop(q, range, o), run, ctx));
    const result: TopValuesResult = {
      rows: rows.map((r) => ({ value: strOrNull(r.value), count: num(r.c), uniqueUsers: num(r.u) })),
    };
    return result;
  }

  private async summary(range: ResolvedRange, o: CompileOpts, run: Run, ctx?: QueryContext) {
    const prev = previousRange(range);
    const [r] = objects(await this.run(compileSummary(range, prev, o), run, ctx));
    const np = await this.newPersons(range, prev, run, ctx);
    const result: SummaryResult = {
      events: num(r?.events),
      uniqueUsers: num(r?.users),
      newUsers: np ? np.cur : null,
      previous: { events: num(r?.prev_events), uniqueUsers: num(r?.prev_users), newUsers: np ? np.prev : null },
    };
    return result;
  }

  private async web(range: ResolvedRange, o: CompileOpts, run: Run, ctx?: QueryContext): Promise<WebStatsResult> {
    const [totals] = objects(await this.run(compileWebTotals(range, o), run, ctx));
    const sessions = objects(await this.run(compileWebSessions(range, o), run, ctx));
    const totalSessions = sessions.reduce((a, r) => a + num(r.sessions), 0);
    const bounced = sessions.reduce((a, r) => a + num(r.bounced), 0);
    const tops = async (key: string) =>
      (
        await this.top(
          { kind: "top", event: "$pageview", groupBy: { type: "event", key, limit: 10 }, dateRange: { from: "-7d", to: "now" }, filters: [], limit: 10 },
          range,
          o,
          run,
          ctx,
        )
      ).rows;
    return {
      pageviews: num(totals?.pageviews),
      visitors: num(totals?.visitors),
      sessions: num(totals?.sessions),
      bounceRate: totalSessions ? bounced / totalSessions : null,
      bounceDefinition: "Share of sessions (by $session_id) with exactly one $pageview in the range.",
      topPages: await tops("$pathname"),
      entryPages: sessions.slice(0, 10).map((r) => ({ value: strOrNull(r.entry), count: num(r.sessions), uniqueUsers: num(r.visitors) })),
      referrers: await tops("$referring_domain"),
      utmSources: await tops("utm_source"),
      browsers: await tops("$browser"),
      devices: await tops("$device_type"),
    };
  }

  private async retention(q: RetentionQuery, range: ResolvedRange, o: CompileOpts, run: Run, ctx?: QueryContext) {
    const sizes = objects(await this.run(compileRetentionCohorts(q, range, o), run, ctx));
    const cells = objects(await this.run(compileRetention(q, range, o), run, ctx));
    const periodMs = (q.period === "day" ? 1 : 7) * 86400_000;
    const now = Date.now();
    const result: RetentionResult = {
      period: q.period,
      definition: `Cohort = first ${q.startEvent ?? "event"} per person within the range (by ${q.period}, ${o.timezone}). Retained in period N = performed ${q.returnEvent ?? "any event"} during that ${q.period}. Exact (not rolling) retention. Periods that have not finished are shown empty.`,
      cohorts: sizes.map((s) => {
        const start = String(s.cohort).slice(0, 10);
        const startMs = new Date(`${start}T00:00:00Z`).getTime();
        const values: (number | null)[] = [];
        for (let i = 0; i <= q.periods; i++) {
          if (startMs + (i + 1) * periodMs > now + 86400_000) {
            values.push(null);
            continue;
          }
          const cell = cells.find((c) => String(c.cohort).slice(0, 10) === start && num(c.period_index) === i);
          values.push(cell ? num(cell.persons) : 0);
        }
        return { start, size: num(s.size), values };
      }),
    };
    return result;
  }
}

export type { Run };
