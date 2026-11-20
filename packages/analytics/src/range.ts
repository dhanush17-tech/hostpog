import type { DateRange, ResolvedRange } from "@hostpog/contracts";

const REL = /^-(\d{1,4})([hdwm])$/;

function resolveExpr(expr: string, now: Date): Date {
  if (expr === "now") return now;
  const rel = REL.exec(expr);
  if (rel) {
    const n = Number(rel[1]);
    const d = new Date(now);
    switch (rel[2]) {
      case "h":
        d.setUTCHours(d.getUTCHours() - n);
        return d;
      case "d":
        d.setUTCDate(d.getUTCDate() - n);
        return d;
      case "w":
        d.setUTCDate(d.getUTCDate() - 7 * n);
        return d;
      case "m":
        d.setUTCMonth(d.getUTCMonth() - n);
        return d;
    }
  }
  const parsed = new Date(expr.length === 10 ? `${expr}T00:00:00Z` : expr);
  if (Number.isNaN(parsed.getTime())) throw new Error(`invalid date: ${expr}`);
  return parsed;
}

function tzOffsetMs(d: Date, tz: string): number {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const asUtc = Date.UTC(+parts.year!, +parts.month! - 1, +parts.day!, +parts.hour!, +parts.minute!, +parts.second!);
  return asUtc - Math.floor(d.getTime() / 1000) * 1000; // local minus UTC
}

/** UTC instant of local midnight (in `tz`) for the local day containing `d`. DST-safe. */
export function startOfLocalDay(d: Date, tz: string): Date {
  const local = new Date(d.getTime() + tzOffsetMs(d, tz));
  const midnightAsUtc = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  // the offset at midnight can differ from the offset at `d` on DST transition days
  let guess = midnightAsUtc - tzOffsetMs(d, tz);
  guess = midnightAsUtc - tzOffsetMs(new Date(guess), tz);
  return new Date(guess);
}

/**
 * Resolve to [from, to). Relative "from" values for d/w/m snap to the start of
 * the day in the reporting timezone, so day buckets are whole local days.
 */
export function resolveRange(range: DateRange, nowInput = new Date(), tz = "UTC"): ResolvedRange {
  // Snap "now" up to the next whole minute so equivalent relative queries share
  // cache entries and fingerprints (and nothing recent is excluded).
  const now = new Date(Math.ceil(nowInput.getTime() / 60_000) * 60_000);
  let from = resolveExpr(range.from, now);
  const to = resolveExpr(range.to, now);
  if (REL.test(range.from) && !range.from.endsWith("h")) {
    from = startOfLocalDay(from, tz);
  }
  if (from >= to) throw new Error("date range is empty: from must be before to");
  const maxSpanMs = 400 * 86400_000;
  if (to.getTime() - from.getTime() > maxSpanMs) throw new Error("date range exceeds 400 days");
  return { from: from.toISOString(), to: to.toISOString() };
}

export function previousRange(r: ResolvedRange): ResolvedRange {
  const from = new Date(r.from).getTime();
  const to = new Date(r.to).getTime();
  const span = to - from;
  return { from: new Date(from - span).toISOString(), to: new Date(from).toISOString() };
}

/** ClickHouse/HogQL-friendly "YYYY-MM-DD HH:MM:SS.mmm" in UTC. */
export function toSqlDateTime(iso: string): string {
  return iso.replace("T", " ").replace("Z", "").slice(0, 23);
}
