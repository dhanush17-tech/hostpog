import { getClickHouse, logsOverview, searchLogs, LOG_LEVELS, type LogLevel } from "@hostpog/native";
import { z } from "zod";
import type { ProjectAccess } from "./authz";
import { HttpError } from "./http";
import { projectSources } from "./sources";

export const LogsQuery = z.object({
  range: z.enum(["15m", "1h", "6h", "24h", "7d", "30d"]).default("24h"),
  levels: z
    .string()
    .optional()
    .transform((s) => (s ? s.split(",").filter((l): l is LogLevel => (LOG_LEVELS as readonly string[]).includes(l)) : undefined)),
  service: z.string().max(200).optional(),
  q: z.string().max(500).optional(),
  traceId: z.string().max(64).optional(),
  distinctId: z.string().max(400).optional(),
  before: z.string().datetime().optional(),
  sourceId: z.string().uuid().optional(),
});

const RANGE_S = { "15m": 900, "1h": 3600, "6h": 21600, "24h": 86400, "7d": 604800, "30d": 2592000 } as const;

/** Logs live in HostPog's own store, keyed by the source that received them (the project key's source). */
export async function queryLogs(a: ProjectAccess, raw: Record<string, string>) {
  const p = LogsQuery.parse(raw);
  const sources = await projectSources(a.project.id);
  const ids = p.sourceId ? sources.filter((s) => s.id === p.sourceId).map((s) => s.id) : sources.map((s) => s.id);
  if (!ids.length) throw new HttpError(404, "No data source connected to this project", "no_source");
  const now = Date.now();
  const span = RANGE_S[p.range];
  const search = { from: new Date(now - span * 1000).toISOString(), to: new Date(now + 60_000).toISOString(), levels: p.levels, service: p.service, q: p.q, traceId: p.traceId, distinctId: p.distinctId };
  const ch = getClickHouse();
  const [rows, overview] = await Promise.all([
    searchLogs(ch, ids, { ...search, before: p.before, limit: 200 }),
    p.before ? Promise.resolve(null) : logsOverview(ch, ids, search, Math.max(60, Math.round(span / 60))),
  ]);
  return { range: p.range, rows, overview, nextBefore: rows.length === 200 ? rows[rows.length - 1]!.timestamp : null };
}
