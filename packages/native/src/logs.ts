/**
 * Logs: OTLP/HTTP JSON (what posthog-js's logger and OpenTelemetry exporters send) or a simple JSON list,
 * stored in the `logs` table (ClickHouse or Tinybird, 30-day TTL) and searched by project partition.
 */
import type { ClickHouseClient } from "@clickhouse/client";

export interface LogRow {
  project_id: string;
  source_id: string;
  timestamp: string;
  received_at: string;
  level: string;
  service: string;
  message: string;
  attributes: Record<string, string>;
  trace_id: string;
  distinct_id: string;
}

export const LOG_LEVELS = ["trace", "debug", "info", "warn", "error", "fatal"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

const chTime = (d: Date) => d.toISOString().replace("T", " ").replace("Z", "");

function normLevel(text: unknown, num: unknown): LogLevel {
  const t = typeof text === "string" ? text.toLowerCase() : "";
  if (t.startsWith("fatal") || t === "critical") return "fatal";
  if (t.startsWith("err")) return "error";
  if (t.startsWith("warn")) return "warn";
  if (t.startsWith("info")) return "info";
  if (t.startsWith("debug")) return "debug";
  if (t.startsWith("trace")) return "trace";
  const n = Number(num);
  if (n >= 21) return "fatal";
  if (n >= 17) return "error";
  if (n >= 13) return "warn";
  if (n >= 9) return "info";
  if (n >= 5) return "debug";
  if (n >= 1) return "trace";
  return "info";
}

type OtlpValue = { stringValue?: string; intValue?: string | number; doubleValue?: number; boolValue?: boolean; arrayValue?: { values?: OtlpValue[] }; kvlistValue?: { values?: OtlpKv[] } };
type OtlpKv = { key: string; value?: OtlpValue };

function val(v: OtlpValue | undefined): string {
  if (!v) return "";
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.intValue !== undefined) return String(v.intValue);
  if (v.doubleValue !== undefined) return String(v.doubleValue);
  if (v.boolValue !== undefined) return String(v.boolValue);
  if (v.arrayValue) return JSON.stringify((v.arrayValue.values ?? []).map(val));
  if (v.kvlistValue) return JSON.stringify(Object.fromEntries((v.kvlistValue.values ?? []).map((kv) => [kv.key, val(kv.value)])));
  return "";
}

function attrs(list: OtlpKv[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const kv of list ?? []) if (kv?.key && Object.keys(out).length < 100) out[kv.key.slice(0, 200)] = val(kv.value).slice(0, 4096);
  return out;
}

function nanosToDate(n: unknown, fallback: Date): Date {
  const s = String(n ?? "");
  if (!/^\d+$/.test(s) || s === "0") return fallback;
  const ms = Number(BigInt(s) / 1_000_000n);
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? fallback : d;
}

export interface SimpleLog {
  timestamp?: string;
  level?: string;
  message: string;
  service?: string;
  attributes?: Record<string, unknown>;
  trace_id?: string;
  distinct_id?: string;
}

/** Accepts OTLP JSON ({ resourceLogs }) or { logs: SimpleLog[] }. Returns rows ready to insert. */
export function parseLogs(body: unknown, partitionId: string, now = new Date()): { rows: LogRow[]; rejected: number } {
  const rows: LogRow[] = [];
  let rejected = 0;
  const maxTs = now.getTime() + 3600_000;
  const base = (ts: Date) => ({ project_id: partitionId, source_id: partitionId, timestamp: chTime(ts.getTime() > maxTs ? now : ts), received_at: chTime(now) });
  const b = (body ?? {}) as { resourceLogs?: unknown[]; logs?: unknown[] };
  if (Array.isArray(b.resourceLogs)) {
    for (const rl of b.resourceLogs as { resource?: { attributes?: OtlpKv[] }; scopeLogs?: { logRecords?: Record<string, unknown>[] }[] }[]) {
      const res = attrs(rl.resource?.attributes);
      const service = res["service.name"] ?? "";
      for (const sl of rl.scopeLogs ?? []) {
        for (const r of sl.logRecords ?? []) {
          const message = val(r.body as OtlpValue | undefined);
          if (!message) {
            rejected++;
            continue;
          }
          const a = { ...res, ...attrs(r.attributes as OtlpKv[] | undefined) };
          rows.push({
            ...base(nanosToDate(r.timeUnixNano ?? r.observedTimeUnixNano, now)),
            level: normLevel(r.severityText, r.severityNumber),
            service: service.slice(0, 200),
            message: message.slice(0, 32_768),
            attributes: a,
            trace_id: String(r.traceId ?? "").slice(0, 64),
            distinct_id: (a["posthog.distinct_id"] ?? a["distinct_id"] ?? a["posthogDistinctId"] ?? "").slice(0, 400),
          });
        }
      }
    }
  } else if (Array.isArray(b.logs)) {
    for (const l of b.logs as SimpleLog[]) {
      if (!l || typeof l.message !== "string" || !l.message) {
        rejected++;
        continue;
      }
      const ts = l.timestamp ? new Date(l.timestamp) : now;
      const a: Record<string, string> = {};
      for (const [k, v] of Object.entries(l.attributes ?? {}).slice(0, 100)) a[k.slice(0, 200)] = (typeof v === "string" ? v : JSON.stringify(v)).slice(0, 4096);
      rows.push({
        ...base(Number.isNaN(ts.getTime()) ? now : ts),
        level: normLevel(l.level, 0),
        service: String(l.service ?? "").slice(0, 200),
        message: l.message.slice(0, 32_768),
        attributes: a,
        trace_id: String(l.trace_id ?? "").slice(0, 64),
        distinct_id: String(l.distinct_id ?? "").slice(0, 400),
      });
    }
  }
  return { rows: rows.slice(0, 10_000), rejected };
}

export async function insertLogs(ch: ClickHouseClient, rows: LogRow[]) {
  if (rows.length) await ch.insert({ table: "logs", values: rows, format: "JSONEachRow" });
}

export interface LogsSearch {
  from: string;
  to: string;
  levels?: LogLevel[];
  service?: string;
  /** case-insensitive text search in message */
  q?: string;
  traceId?: string;
  distinctId?: string;
  limit?: number;
  /** keyset cursor: ISO timestamp of the last row */
  before?: string;
}

function where(partitionIds: string[], s: LogsSearch) {
  const params: Record<string, unknown> = { p: partitionIds, from: chTime(new Date(s.from)), to: chTime(new Date(s.to)) };
  const conds = ["project_id IN {p:Array(String)}", "timestamp >= {from:DateTime64(3)}", "timestamp < {to:DateTime64(3)}"];
  if (s.levels?.length) {
    conds.push("level IN {levels:Array(String)}");
    params.levels = s.levels;
  }
  if (s.service) {
    conds.push("service = {service:String}");
    params.service = s.service;
  }
  if (s.q) {
    conds.push("positionCaseInsensitive(message, {q:String}) > 0");
    params.q = s.q;
  }
  if (s.traceId) {
    conds.push("trace_id = {trace:String}");
    params.trace = s.traceId;
  }
  if (s.distinctId) {
    conds.push("distinct_id = {did:String}");
    params.did = s.distinctId;
  }
  if (s.before) {
    conds.push("timestamp < {before:DateTime64(3)}");
    params.before = chTime(new Date(s.before));
  }
  return { sql: conds.join(" AND "), params };
}

export async function searchLogs(ch: ClickHouseClient, partitionIds: string[], s: LogsSearch) {
  const w = where(partitionIds, s);
  const limit = Math.min(Math.max(s.limit ?? 100, 1), 500);
  const res = await ch.query({
    query: `SELECT toString(timestamp) AS ts, level, service, message, attributes, trace_id, distinct_id FROM logs WHERE ${w.sql} ORDER BY timestamp DESC LIMIT ${limit}`,
    query_params: w.params,
    format: "JSONEachRow",
  });
  const rows = (await res.json()) as { ts: string; level: string; service: string; message: string; attributes: Record<string, string>; trace_id: string; distinct_id: string }[];
  return rows.map(({ ts, ...r }) => ({ ...r, timestamp: new Date(ts.replace(" ", "T") + "Z").toISOString() }));
}

/** Counts per level per bucket for the histogram, plus the services seen. */
export async function logsOverview(ch: ClickHouseClient, partitionIds: string[], s: LogsSearch, bucketSeconds: number) {
  const w = where(partitionIds, { ...s, before: undefined });
  const hist = await ch.query({
    query: `SELECT toString(toStartOfInterval(timestamp, INTERVAL ${Math.max(60, Math.trunc(bucketSeconds))} SECOND)) AS t, level, count() AS n FROM logs WHERE ${w.sql} GROUP BY t, level ORDER BY t`,
    query_params: w.params,
    format: "JSONEachRow",
  });
  const sw = where(partitionIds, { from: s.from, to: s.to });
  const svc = await ch.query({
    query: `SELECT service, count() AS n FROM logs WHERE ${sw.sql} GROUP BY service ORDER BY n DESC LIMIT 50`,
    query_params: sw.params,
    format: "JSONEachRow",
  });
  return {
    histogram: ((await hist.json()) as { t: string; level: string; n: string | number }[]).map((r) => ({ t: new Date(r.t.replace(" ", "T") + "Z").toISOString(), level: r.level, n: Number(r.n) })),
    services: ((await svc.json()) as { service: string; n: string | number }[]).map((r) => ({ service: r.service, n: Number(r.n) })),
  };
}

/** Two days of plausible service logs for the demo project: steady info traffic, a few warnings, one error burst. */
export function generateDemoLogs(partitionId: string, opts: { seed?: number; end?: Date; count?: number } = {}): LogRow[] {
  let a = (opts.seed ?? 99) >>> 0;
  const rand = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const end = (opts.end ?? new Date()).getTime();
  const span = 48 * 3600_000;
  const burstAt = end - 5 * 3600_000;
  const routes = ["/api/projects", "/api/billing/checkout", "/api/auth/session", "/api/search", "/api/uploads"];
  const users = Array.from({ length: 40 }, (_, i) => `user_${(i * 7919) % 1000}`);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;
  const hex = (n: number) => Array.from({ length: n }, () => Math.floor(rand() * 16).toString(16)).join("");
  const rows: LogRow[] = [];
  const now = chTime(new Date(end));
  for (let i = 0; i < (opts.count ?? 3000); i++) {
    const burst = rand() < 0.06;
    const ts = burst ? burstAt + rand() * 12 * 60_000 : end - rand() * span;
    const route = burst ? "/api/billing/checkout" : pick(routes);
    const user = pick(users);
    const ms = Math.round(20 + rand() ** 3 * 1800);
    let level: LogLevel = "info";
    let service = route.startsWith("/api/billing") ? "billing" : route.startsWith("/api/auth") ? "auth" : "api";
    let message = `${pick(["GET", "GET", "POST"])} ${route} 200 in ${ms}ms`;
    if (burst) {
      level = "error";
      message = `Stripe webhook failed: signature verification error (request ${hex(8)})`;
    } else if (ms > 1200) {
      level = "warn";
      message = `Slow request: ${route} took ${ms}ms`;
    } else if (rand() < 0.05) {
      service = "worker";
      level = rand() < 0.5 ? "debug" : "info";
      message = pick(["Sent weekly digest email", "Thumbnail generated", "Search index refreshed", "Retrying job after timeout"]);
    }
    rows.push({
      project_id: partitionId,
      source_id: partitionId,
      timestamp: chTime(new Date(ts)),
      received_at: now,
      level,
      service,
      message,
      attributes: { "http.route": route, "http.duration_ms": String(ms), environment: "production" },
      trace_id: hex(32),
      distinct_id: user,
    });
  }
  return rows;
}
