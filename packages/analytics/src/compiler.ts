/**
 * Metric DSL -> parameterized SQL compiler.
 *
 * Two dialects share one compiler:
 *  - "hogql": PostHog's HogQL, sent to POST /api/projects/:id/query/ with a
 *    `values` map. Placeholders look like {p0}. PostHog applies project scoping
 *    and the project timezone itself.
 *  - "clickhouse": HostPog's native ClickHouse schema. Placeholders look like
 *    {p0:String}. Every query is scoped by project_id inside the events source
 *    subquery, independently of any caller (including the AI agent).
 *
 * Only identifiers from the validated DSL reach SQL: event names and filter
 * values always travel as parameters; property keys are validated against a
 * strict alphabet (no quotes/backslashes) before being embedded as literals.
 */
import type {
  Breakdown,
  EventsListQuery,
  FunnelQuery,
  Interval,
  MathType,
  PropertyFilter,
  ResolvedRange,
  RetentionQuery,
  TopValuesQuery,
  TrendSeries,
} from "@hostpog/contracts";
import { toSqlDateTime } from "./range";

export type DialectName = "hogql" | "clickhouse";

export interface CompiledQuery {
  dialect: DialectName;
  text: string;
  params: Record<string, string | number>;
}

const SAFE_KEY = /^[$A-Za-z0-9_.:\- ]{1,200}$/;

export class SqlBuilder {
  readonly params: Record<string, string | number> = {};
  private n = 0;
  constructor(
    readonly dialect: DialectName,
    readonly opts: { projectId?: string; timezone: string },
  ) {
    if (dialect === "clickhouse" && !opts.projectId) throw new Error("native queries require a projectId");
  }

  /** Bind a value and return its placeholder. */
  p(value: string | number, chType: "String" | "Float64" | "Int64" | "DateTime64(3)" = "String"): string {
    const name = `p${this.n++}`;
    this.params[name] = value;
    return this.dialect === "hogql" ? `{${name}}` : `{${name}:${chType}}`;
  }

  dt(iso: string): string {
    // HogQL maps toDateTime(String) to parseDateTime64BestEffortOrNull (tz-aware); an explicit
    // trailing "Z" keeps the instant in UTC regardless of the project timezone.
    if (this.dialect === "hogql") return `toDateTime(${this.p(new Date(iso).toISOString())})`;
    return this.p(toSqlDateTime(iso), "DateTime64(3)");
  }

  /** Events source, aliased `e`, exposing a uniform column set. */
  source(): string {
    if (this.dialect === "hogql") return "events AS e";
    const proj = this.p(this.opts.projectId!);
    return `(
    SELECT ev.uuid AS uuid, ev.event AS event, ev.distinct_id AS distinct_id, ev.timestamp AS timestamp,
           ev.props AS props, ev.properties AS properties, ev.session_id AS session_id,
           if(pdi.person_id = '', ev.distinct_id, pdi.person_id) AS person_id,
           pp.props AS person_props
    FROM events AS ev FINAL
    LEFT JOIN (
      SELECT distinct_id, argMax(person_id, version) AS person_id
      FROM person_distinct_ids WHERE project_id = ${proj} GROUP BY distinct_id
    ) AS pdi ON pdi.distinct_id = ev.distinct_id
    LEFT JOIN (
      SELECT person_id, argMax(props, version) AS props
      FROM person_props WHERE project_id = ${proj} GROUP BY person_id
    ) AS pp ON pp.person_id = if(pdi.person_id = '', ev.distinct_id, pdi.person_id)
    WHERE ev.project_id = ${proj}
  ) AS e`;
  }

  /** Nullable string expression for a property. */
  prop(type: "event" | "person", key: string): string {
    if (!SAFE_KEY.test(key)) throw new Error(`unsafe property key: ${key}`);
    if (this.dialect === "hogql") {
      return type === "event" ? `e.properties['${key}']` : `e.person.properties['${key}']`;
    }
    const col = type === "event" ? "e.props" : "e.person_props";
    const k = this.p(key);
    return `if(mapContains(${col}, ${k}), ${col}[${k}], NULL)`;
  }

  sessionId(): string {
    return this.dialect === "hogql" ? `e.properties['$session_id']` : `nullIf(e.session_id, '')`;
  }

  bucket(interval: Interval): string {
    const fn = { hour: "toStartOfHour", day: "toStartOfDay", week: "toStartOfWeek", month: "toStartOfMonth" }[interval];
    if (this.dialect === "hogql") return `${fn}(e.timestamp)`;
    return `${fn}(toTimeZone(e.timestamp, ${this.p(this.opts.timezone)}))`;
  }

  range(r: ResolvedRange): string {
    return `e.timestamp >= ${this.dt(r.from)} AND e.timestamp < ${this.dt(r.to)}`;
  }

  filter(f: PropertyFilter): string {
    const expr = this.prop(f.type, f.key);
    const v = f.value;
    switch (f.operator) {
      case "is_set":
        return `(${expr} IS NOT NULL)`;
      case "is_not_set":
        return `(${expr} IS NULL)`;
      case "eq":
        return `(toString(${expr}) = ${this.p(String(v))})`;
      case "neq":
        return `(${expr} IS NULL OR toString(${expr}) != ${this.p(String(v))})`;
      case "contains":
        return `(positionCaseInsensitive(toString(${expr}), ${this.p(String(v))}) > 0)`;
      case "not_contains":
        return `(${expr} IS NULL OR positionCaseInsensitive(toString(${expr}), ${this.p(String(v))}) = 0)`;
      case "gt":
        return `(toFloat64OrNull(toString(${expr})) > ${this.p(Number(v), "Float64")})`;
      case "lt":
        return `(toFloat64OrNull(toString(${expr})) < ${this.p(Number(v), "Float64")})`;
    }
  }

  filters(fs: PropertyFilter[]): string[] {
    return fs.map((f) => this.filter(f));
  }

  event(name: string | null): string[] {
    return name === null ? [] : [`e.event = ${this.p(name)}`];
  }

  breakdownExpr(b: Breakdown): string {
    if (b.type === "event_name") return "e.event";
    return `toString(${this.prop(b.type, b.key)})`;
  }

  build(text: string): CompiledQuery {
    return { dialect: this.dialect, text: text.replace(/\n\s*\n/g, "\n").trim(), params: { ...this.params } };
  }
}

function where(parts: string[]): string {
  return parts.length ? `WHERE ${parts.join("\n  AND ")}` : "";
}

function aggregate(math: MathType, b?: SqlBuilder, property?: string): string {
  const num = () => {
    if (!b || !property) throw new Error(`${math} needs a numeric property`);
    return `toFloat64OrNull(toString(${b.prop("event", property)}))`;
  };
  switch (math) {
    case "sum":
      return `coalesce(sum(${num()}), 0)`;
    case "avg":
      return `coalesce(avg(${num()}), 0)`;
    case "p95":
      return `coalesce(quantile(0.95)(${num()}), 0)`;
    case "total":
      return "count()";
    case "unique_users":
      return "count(DISTINCT e.person_id)";
    case "per_user_avg":
      return "count() / greatest(count(DISTINCT e.person_id), 1)";
  }
}

export interface CompileOpts {
  dialect: DialectName;
  projectId?: string;
  timezone: string;
}

export function compileTrendSeries(
  s: TrendSeries,
  globalFilters: PropertyFilter[],
  interval: Interval,
  range: ResolvedRange,
  breakdown: Breakdown | undefined,
  o: CompileOpts,
): CompiledQuery {
  const b = new SqlBuilder(o.dialect, o);
  const src = b.source();
  const conds = [b.range(range), ...b.event(s.event), ...b.filters(globalFilters), ...b.filters(s.filters)];
  const bd = breakdown ? `, ${b.breakdownExpr(breakdown)} AS bd` : "";
  return b.build(`
SELECT toString(${b.bucket(interval)}) AS t${bd}, ${aggregate(s.math, b, s.property)} AS v
FROM ${src}
${where(conds)}
GROUP BY t${breakdown ? ", bd" : ""}
ORDER BY t
LIMIT 10000`);
}

export function compileFunnel(q: FunnelQuery, range: ResolvedRange, o: CompileOpts): CompiledQuery {
  const b = new SqlBuilder(o.dialect, o);
  const src = b.source();
  const stepConds = q.steps.map((s) => [`e.event = ${b.p(s.event)}`, ...b.filters(s.filters)].join(" AND "));
  const eventNames = q.steps.map((s) => b.p(s.event));
  const window = Math.trunc(q.windowSeconds);
  const n = q.steps.length;
  const bdInner = q.breakdown ? `, argMinIf(${b.breakdownExpr(q.breakdown)}, e.timestamp, ${stepConds[0]}) AS bd` : "";
  const conds = [
    // allow the conversion window to extend past the range end for people who start inside it
    `e.timestamp >= ${b.dt(range.from)}`,
    `e.timestamp < ${b.dt(new Date(new Date(range.to).getTime() + window * 1000).toISOString())}`,
    `e.event IN (${eventNames.join(", ")})`,
    ...b.filters(q.filters),
  ];
  const levels = Array.from({ length: n }, (_, i) => `countIf(level >= ${i + 1}) AS s${i + 1}`).join(", ");
  return b.build(`
SELECT ${q.breakdown ? "bd, " : ""}${levels},
       quantileIf(0.5)(dateDiff('second', t_first, t_last), level = ${n} AND t_last >= t_first) AS median_seconds
FROM (
  SELECT e.person_id AS pid,
         windowFunnel(${window})(toDateTime(e.timestamp), ${stepConds.join(", ")}) AS level,
         minIf(e.timestamp, ${stepConds[0]}) AS t_first,
         minIf(e.timestamp, ${stepConds[n - 1]}) AS t_last${bdInner}
  FROM ${src}
  ${where(conds)}
  GROUP BY pid
  HAVING t_first >= ${b.dt(range.from)} AND t_first < ${b.dt(range.to)}
)
${q.breakdown ? "GROUP BY bd ORDER BY s1 DESC LIMIT " + q.breakdown.limit : ""}`);
}

/** Persons who reached step N (level >= N) or dropped right before it (level = N-1). */
export function compileFunnelPersons(q: Omit<FunnelQuery, "kind"> & { step: number; outcome: "reached" | "dropped"; limit: number }, range: ResolvedRange, o: CompileOpts): CompiledQuery {
  const b = new SqlBuilder(o.dialect, o);
  const src = b.source();
  const stepConds = q.steps.map((s) => [`e.event = ${b.p(s.event)}`, ...b.filters(s.filters)].join(" AND "));
  const eventNames = q.steps.map((s) => b.p(s.event));
  const window = Math.trunc(q.windowSeconds);
  const step = Math.min(Math.max(1, Math.trunc(q.step)), q.steps.length);
  const levelCond = q.outcome === "reached" ? `level >= ${step}` : `level = ${step - 1}`;
  return b.build(`
SELECT toString(pid) AS person_id, level
FROM (
  SELECT e.person_id AS pid,
         windowFunnel(${window})(toDateTime(e.timestamp), ${stepConds.join(", ")}) AS level,
         minIf(e.timestamp, ${stepConds[0]}) AS t_first
  FROM ${src}
  WHERE e.timestamp >= ${b.dt(range.from)}
    AND e.timestamp < ${b.dt(new Date(new Date(range.to).getTime() + window * 1000).toISOString())}
    AND e.event IN (${eventNames.join(", ")})
    ${b.filters(q.filters).map((f) => `AND ${f}`).join(" ")}
  GROUP BY pid
  HAVING t_first >= ${b.dt(range.from)} AND t_first < ${b.dt(range.to)}
)
WHERE ${levelCond}
ORDER BY pid
LIMIT ${Math.trunc(q.limit)}`);
}

export function compileEvents(q: EventsListQuery, range: ResolvedRange, o: CompileOpts): CompiledQuery {
  const b = new SqlBuilder(o.dialect, o);
  const src = b.source();
  const conds = [b.range(range), ...b.event(q.event ?? null), ...b.filters(q.filters)];
  if (q.distinctId) conds.push(`e.distinct_id = ${b.p(q.distinctId)}`);
  if (q.personId) conds.push(`toString(e.person_id) = ${b.p(q.personId)}`);
  if (q.cursor) {
    const ts = b.dt(q.cursor.ts);
    conds.push(`(e.timestamp < ${ts} OR (e.timestamp = ${ts} AND toString(e.uuid) < ${b.p(q.cursor.uuid)}))`);
  }
  return b.build(`
SELECT toString(e.uuid) AS uuid, e.event AS event, e.distinct_id AS distinct_id, toString(e.person_id) AS person_id,
       e.timestamp AS timestamp, ${b.sessionId()} AS session_id, e.properties AS properties
FROM ${src}
${where(conds)}
ORDER BY e.timestamp DESC, uuid DESC
LIMIT ${Math.trunc(q.limit) + 1}`);
}

export function compileTop(q: TopValuesQuery, range: ResolvedRange, o: CompileOpts): CompiledQuery {
  const b = new SqlBuilder(o.dialect, o);
  const src = b.source();
  const conds = [b.range(range), ...b.event(q.event), ...b.filters(q.filters)];
  return b.build(`
SELECT ${b.breakdownExpr(q.groupBy)} AS value, count() AS c, count(DISTINCT e.person_id) AS u
FROM ${src}
${where(conds)}
GROUP BY value
ORDER BY c DESC
LIMIT ${Math.trunc(q.limit)}`);
}

export function compileSummary(range: ResolvedRange, prev: ResolvedRange, o: CompileOpts): CompiledQuery {
  const b = new SqlBuilder(o.dialect, o);
  const src = b.source();
  const cur = b.range(range);
  const old = b.range(prev);
  return b.build(`
SELECT countIf(${cur}) AS events,
       count(DISTINCT if(${cur}, e.person_id, NULL)) AS users,
       countIf(${old}) AS prev_events,
       count(DISTINCT if(${old}, e.person_id, NULL)) AS prev_users
FROM ${src}
WHERE e.timestamp >= ${b.dt(prev.from)} AND e.timestamp < ${b.dt(range.to)}`);
}

/** PostHog only: persons first created in the range (person profile creation time). */
export function compileHogqlNewPersons(range: ResolvedRange, prev: ResolvedRange): CompiledQuery {
  const b = new SqlBuilder("hogql", { timezone: "UTC" });
  return b.build(`
SELECT countIf(created_at >= ${b.dt(range.from)} AND created_at < ${b.dt(range.to)}) AS cur,
       countIf(created_at >= ${b.dt(prev.from)} AND created_at < ${b.dt(prev.to)}) AS prev
FROM persons
WHERE created_at >= ${b.dt(prev.from)} AND created_at < ${b.dt(range.to)}`);
}

export function compileWebTotals(range: ResolvedRange, o: CompileOpts): CompiledQuery {
  const b = new SqlBuilder(o.dialect, o);
  const src = b.source();
  const sid = b.sessionId();
  return b.build(`
SELECT count() AS pageviews, count(DISTINCT e.person_id) AS visitors, count(DISTINCT ${sid}) AS sessions
FROM ${src}
WHERE ${b.range(range)} AND e.event = ${b.p("$pageview")}`);
}

export function compileWebSessions(range: ResolvedRange, o: CompileOpts): CompiledQuery {
  const b = new SqlBuilder(o.dialect, o);
  const src = b.source();
  const sid = b.sessionId();
  const path = b.prop("event", "$pathname");
  return b.build(`
SELECT entry, count() AS sessions, count(DISTINCT pid) AS visitors, countIf(pv = 1) AS bounced
FROM (
  SELECT ${sid} AS sid, argMin(toString(${path}), e.timestamp) AS entry, any(e.person_id) AS pid, count() AS pv
  FROM ${src}
  WHERE ${b.range(range)} AND e.event = ${b.p("$pageview")} AND ${sid} IS NOT NULL
  GROUP BY sid
)
GROUP BY entry
ORDER BY sessions DESC
LIMIT 200`);
}

export function compileRetentionCohorts(q: RetentionQuery, range: ResolvedRange, o: CompileOpts): CompiledQuery {
  const b = new SqlBuilder(o.dialect, o);
  const startOf =
    o.dialect === "hogql"
      ? `${q.period === "day" ? "toStartOfDay" : "toStartOfWeek"}(e.timestamp)`
      : `${q.period === "day" ? "toStartOfDay" : "toStartOfWeek"}(toTimeZone(e.timestamp, ${b.p(o.timezone)}))`;
  const src = b.source();
  const conds = [b.range(range), ...b.event(q.startEvent)];
  return b.build(`
SELECT toString(cohort) AS cohort, count() AS size
FROM (
  SELECT e.person_id AS pid, min(${startOf}) AS cohort
  FROM ${src}
  ${where(conds)}
  GROUP BY pid
)
GROUP BY cohort
ORDER BY cohort
LIMIT 500`);
}

export function compileRetention(q: RetentionQuery, range: ResolvedRange, o: CompileOpts): CompiledQuery {
  const b = new SqlBuilder(o.dialect, o);
  const unit = q.period;
  const startOf = (expr: string) =>
    o.dialect === "hogql"
      ? `${unit === "day" ? "toStartOfDay" : "toStartOfWeek"}(${expr})`
      : `${unit === "day" ? "toStartOfDay" : "toStartOfWeek"}(toTimeZone(${expr}, ${b.p(o.timezone)}))`;
  const periodMs = (unit === "day" ? 1 : 7) * 86400_000;
  const returnEnd = new Date(Math.min(Date.now(), new Date(range.to).getTime() + q.periods * periodMs)).toISOString();
  const srcA = b.source();
  const startConds = [b.range(range), ...b.event(q.startEvent)];
  const srcB = b.source();
  const returnConds = [`e.timestamp >= ${b.dt(range.from)}`, `e.timestamp < ${b.dt(returnEnd)}`, ...b.event(q.returnEvent)];
  return b.build(`
SELECT toString(f.cohort) AS cohort, dateDiff('${unit}', f.cohort, r.period_start) AS period_index, count(DISTINCT f.pid) AS persons
FROM (
  SELECT e.person_id AS pid, min(${startOf("e.timestamp")}) AS cohort
  FROM ${srcA}
  ${where(startConds)}
  GROUP BY pid
) AS f
INNER JOIN (
  SELECT DISTINCT e.person_id AS pid, ${startOf("e.timestamp")} AS period_start
  FROM ${srcB}
  ${where(returnConds)}
) AS r ON r.pid = f.pid
WHERE r.period_start >= f.cohort AND dateDiff('${unit}', f.cohort, r.period_start) <= ${Math.trunc(q.periods)}
GROUP BY cohort, period_index
ORDER BY cohort, period_index
LIMIT 5000`);
}
