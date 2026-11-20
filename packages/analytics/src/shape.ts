import type {
  FunnelQuery,
  FunnelResult,
  FunnelStepResult,
  Interval,
  ResolvedRange,
  TrendSeries,
  TrendSeriesResult,
} from "@hostpog/contracts";

export interface RowSet {
  columns: string[];
  rows: unknown[][];
}

export function objects(rs: RowSet): Record<string, unknown>[] {
  return rs.rows.map((r) => Object.fromEntries(rs.columns.map((c, i) => [c, r[i]])));
}

export function num(v: unknown): number {
  if (v === null || v === undefined || v === "") return 0;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function strOrNull(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v);
  return s === "" || s === "\\N" ? null : s;
}

const LABEL = /(\d{4}-\d{2}-\d{2})(?:[T ](\d{2}))?/;

export function normalizeBucket(raw: unknown, interval: Interval): string {
  const m = LABEL.exec(String(raw));
  if (!m) return String(raw);
  return interval === "hour" ? `${m[1]} ${m[2] ?? "00"}:00` : m[1]!;
}

function localParts(d: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
    weekday: "short",
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  return parts as Record<string, string>;
}

const WEEKDAY: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

export function bucketLabel(d: Date, interval: Interval, tz: string): string {
  const p = localParts(d, tz);
  const date = `${p.year}-${p.month}-${p.day}`;
  switch (interval) {
    case "hour":
      return `${date} ${p.hour}:00`;
    case "day":
      return date;
    case "month":
      return `${p.year}-${p.month}-01`;
    case "week": {
      const local = new Date(`${date}T00:00:00Z`);
      local.setUTCDate(local.getUTCDate() - (WEEKDAY[p.weekday!] ?? 0));
      return local.toISOString().slice(0, 10);
    }
  }
}

/** Every bucket label touched by [from, to) in the given timezone, in order. */
export function bucketLabels(range: ResolvedRange, interval: Interval, tz: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const end = new Date(range.to).getTime();
  for (let t = new Date(range.from).getTime(); t < end; t += 3600_000) {
    const l = bucketLabel(new Date(t), interval, tz);
    if (!seen.has(l)) {
      seen.add(l);
      out.push(l);
    }
  }
  const last = bucketLabel(new Date(end - 1), interval, tz);
  if (!seen.has(last)) out.push(last);
  return out;
}

export function seriesLabel(s: TrendSeries, i: number): string {
  if (s.label) return s.label;
  const ev = s.event ?? "All events";
  const prop = s.property ?? "property";
  const m = {
    total: "",
    unique_users: " (unique users)",
    per_user_avg: " (per user)",
    sum: ` (sum of ${prop})`,
    avg: ` (average ${prop})`,
    p95: ` (p95 ${prop})`,
  }[s.math];
  return `${ev}${m}` || `Series ${i + 1}`;
}

export function shapeTrend(
  rs: RowSet,
  s: TrendSeries,
  index: number,
  labels: string[],
  interval: Interval,
  breakdownLimit: number | null,
): TrendSeriesResult[] {
  const byBd = new Map<string | null, Map<string, number>>();
  for (const r of objects(rs)) {
    const bd = breakdownLimit === null ? null : strOrNull(r.bd);
    const key = breakdownLimit === null ? "__all__" : (bd ?? "__null__");
    const m = byBd.get(key) ?? new Map<string, number>();
    const t = normalizeBucket(r.t, interval);
    m.set(t, (m.get(t) ?? 0) + num(r.v));
    byBd.set(key, m);
  }
  const base = seriesLabel(s, index);
  const mk = (bucketMap: Map<string, number>, bdValue: string | null | undefined, label: string): TrendSeriesResult => {
    const points = labels.map((t) => ({ t, v: bucketMap.get(t) ?? 0 }));
    return {
      label,
      event: s.event,
      math: s.math,
      ...(bdValue !== undefined ? { breakdownValue: bdValue } : {}),
      points,
      // additive measures sum over the range; for the others (distinct users, averages, percentiles) the busiest bucket
      total: s.math === "total" || s.math === "sum" ? points.reduce((a, p) => a + p.v, 0) : Math.max(0, ...points.map((p) => p.v)),
    };
  };
  if (breakdownLimit === null) return [mk(byBd.get("__all__") ?? new Map(), undefined, base)];

  const entries = [...byBd.entries()].map(([k, m]) => ({
    value: k === "__null__" ? null : k,
    m,
    total: [...m.values()].reduce((a, b) => a + b, 0),
  }));
  entries.sort((a, b) => b.total - a.total);
  const top = entries.slice(0, breakdownLimit);
  const rest = entries.slice(breakdownLimit);
  const out = top.map((e) => mk(e.m, e.value, `${base} · ${e.value ?? "(none)"}`));
  if (rest.length && (s.math === "total" || s.math === "sum")) {
    const other = new Map<string, number>();
    for (const e of rest) for (const [t, v] of e.m) other.set(t, (other.get(t) ?? 0) + v);
    out.push(mk(other, "__other__", `${base} · Other (${rest.length} values)`));
  }
  return out;
}

function funnelSteps(q: FunnelQuery, counts: number[]): FunnelStepResult[] {
  const first = counts[0] ?? 0;
  return q.steps.map((s, i) => {
    const c = counts[i] ?? 0;
    const prev = i === 0 ? c : (counts[i - 1] ?? 0);
    return {
      event: s.event,
      label: s.label ?? s.event,
      count: c,
      conversionFromStart: first ? c / first : 0,
      conversionFromPrevious: prev ? c / prev : 0,
      dropOff: i === 0 ? 0 : prev - c,
    };
  });
}

export function shapeFunnel(rs: RowSet, q: FunnelQuery): FunnelResult {
  const rows = objects(rs);
  const counts = (r: Record<string, unknown>) => q.steps.map((_, i) => num(r[`s${i + 1}`]));
  if (q.breakdown) {
    const breakdowns = rows.map((r) => ({ value: strOrNull(r.bd), steps: funnelSteps(q, counts(r)) }));
    const totals = q.steps.map((_, i) => rows.reduce((a, r) => a + num(r[`s${i + 1}`]), 0));
    return {
      steps: funnelSteps(q, totals),
      medianSecondsToConvert: null,
      breakdowns,
      denominator: "unique persons who performed step 1 in range",
    };
  }
  const r = rows[0] ?? {};
  const median = r.median_seconds;
  const medianNum = median === null || median === undefined || Number.isNaN(Number(median)) ? null : Number(median);
  return {
    steps: funnelSteps(q, counts(r)),
    medianSecondsToConvert: counts(r)[q.steps.length - 1] ? medianNum : null,
    denominator: "unique persons who performed step 1 in range",
  };
}

export function parseProps(v: unknown): Record<string, unknown> {
  if (v && typeof v === "object") return v as Record<string, unknown>;
  if (typeof v === "string" && v.length) {
    try {
      const o = JSON.parse(v);
      return o && typeof o === "object" ? o : {};
    } catch {
      return {};
    }
  }
  return {};
}

export function toIso(v: unknown): string {
  const s = String(v);
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(s)) return new Date(`${s.replace(" ", "T")}Z`).toISOString();
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? s : d.toISOString();
}
