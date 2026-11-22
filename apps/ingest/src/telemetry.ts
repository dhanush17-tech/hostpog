/**
 * Anonymous install telemetry for self-hosted HostPog.
 *
 * Off unless HOSTPOG_TELEMETRY=1 (./hostpog up asks once and writes it to deploy/.env).
 * Once a day each install sends ONE event with coarse, anonymous numbers:
 *   install id (a one-way hash, not linked to any person), version, team size and
 *   usage as buckets, and which features are switched on.
 * It never sends events, emails, names, keys, URLs or anything about your users.
 * The full payload is built in buildPing() below, so what you read is what is sent.
 */
import { getSqlClient } from "@hostpog/db";
import { getClickHouse } from "@hostpog/native";
import { createHash, randomUUID } from "node:crypto";
import { arch, platform } from "node:os";

// Where pings go: the HostPog project that counts installs. Overridable for testing.
export const TELEMETRY_URL = "https://ingest-production-5c3ec2fa.up.railway.app";
// Public, write-only project key of that project (hp_pk_…). Empty = telemetry can't send.
export const TELEMETRY_KEY = "";

const VERSION = process.env.HOSTPOG_VERSION ?? "0.1.0";
const DAY_MS = 24 * 60 * 60 * 1000;

export interface UsageCounts {
  largestTeam: number;
  workspaces: number;
  projects: number;
  events24h: number;
  flags: number;
  experiments: number;
  surveys: number;
  workflows: number;
  aiProviders: number;
  logs7d: number;
}

export function bucket(n: number, edges: number[]): string {
  if (n <= 0) return "0";
  for (let i = 0; i < edges.length; i++) {
    const hi = edges[i] as number;
    const lo = i === 0 ? 1 : (edges[i - 1] as number) + 1;
    if (n <= hi) return lo === hi ? String(hi) : `${lo}-${hi}`;
  }
  return `${(edges[edges.length - 1] as number) + 1}+`;
}

export function installId(seed: string): string {
  return createHash("sha256").update(`hostpog-telemetry:${seed}`).digest("hex").slice(0, 32);
}

export function telemetryEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const key = env.HOSTPOG_TELEMETRY_KEY ?? TELEMETRY_KEY;
  return env.HOSTPOG_TELEMETRY === "1" && /^hp_pk_[A-Za-z0-9_-]{16,64}$/.test(key);
}

/** The exact event that is sent. Only buckets and booleans leave the machine. */
export function buildPing(counts: UsageCounts, seed: string, now = new Date()) {
  return {
    uuid: randomUUID(),
    event: "hostpog_install_ping",
    distinct_id: installId(seed),
    timestamp: now.toISOString(),
    properties: {
      $process_person_profile: false,
      version: VERSION,
      os: platform(),
      arch: arch(),
      events_backend: process.env.HOSTPOG_EVENTS_BACKEND ?? "clickhouse",
      team_size: bucket(counts.largestTeam, [1, 5, 20, 50]),
      workspaces: bucket(counts.workspaces, [1, 3, 10]),
      projects: bucket(counts.projects, [1, 3, 10]),
      events_per_day: bucket(counts.events24h, [1000, 10_000, 100_000, 1_000_000, 10_000_000]),
      uses_flags: counts.flags > 0,
      uses_experiments: counts.experiments > 0,
      uses_surveys: counts.surveys > 0,
      uses_workflows: counts.workflows > 0,
      uses_ai: counts.aiProviders > 0,
      uses_logs: counts.logs7d > 0,
    },
  };
}

const TABLES = ["workspaces", "projects", "feature_flags", "experiments", "surveys", "workflows", "ai_providers"] as const;

async function countPg(table: (typeof TABLES)[number]): Promise<number> {
  const pg = getSqlClient();
  // to_regclass keeps this working on installs that predate a table.
  const [ok] = await pg`select to_regclass(${"public." + table}) is not null as ok`;
  if (!ok?.ok) return 0;
  const [r] = await pg.unsafe(`select count(*)::int as n from ${table}`);
  return Number(r?.n ?? 0);
}

async function countCh(query: string): Promise<number> {
  try {
    const res = await getClickHouse().query({ query, format: "JSONEachRow" });
    const rows = (await res.json()) as { n: string | number }[];
    return Number(rows[0]?.n ?? 0);
  } catch {
    return 0;
  }
}

export async function collectCounts(): Promise<UsageCounts> {
  const pg = getSqlClient();
  const [team] = await pg`select coalesce(max(c), 0)::int as n from (select count(*) c from memberships group by workspace_id) t`;
  const [workspaces, projects, flags, experiments, surveys, workflows, aiProviders] = await Promise.all([
    countPg("workspaces"),
    countPg("projects"),
    countPg("feature_flags"),
    countPg("experiments"),
    countPg("surveys"),
    countPg("workflows"),
    countPg("ai_providers"),
  ]);
  const [events24h, logs7d] = await Promise.all([
    countCh("SELECT count() AS n FROM events WHERE timestamp > now() - INTERVAL 1 DAY"),
    countCh("SELECT count() AS n FROM logs WHERE timestamp > now() - INTERVAL 7 DAY"),
  ]);
  return { largestTeam: Number(team?.n ?? 0), workspaces, projects, events24h, flags, experiments, surveys, workflows, aiProviders, logs7d };
}

export async function sendPing(log: { info: (o: object, m?: string) => void; warn: (o: object, m?: string) => void }, fetchImpl: typeof fetch = fetch) {
  const url = (process.env.HOSTPOG_TELEMETRY_URL ?? TELEMETRY_URL).replace(/\/$/, "");
  const key = process.env.HOSTPOG_TELEMETRY_KEY ?? TELEMETRY_KEY;
  const seed = process.env.HOSTPOG_MASTER_KEY ?? process.env.DATABASE_URL ?? "dev";
  try {
    const ping = buildPing(await collectCounts(), seed);
    const res = await fetchImpl(`${url}/v1/batch`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ sent_at: new Date().toISOString(), batch: [ping] }),
      signal: AbortSignal.timeout(10_000),
    });
    log.info({ status: res.status }, "telemetry ping sent");
    return ping;
  } catch (err) {
    log.warn({ err: String(err) }, "telemetry ping failed (ignored)");
    return null;
  }
}

/** Starts the daily ping. Returns a stop function. Does nothing when telemetry is off. */
export function startTelemetry(log: Parameters<typeof sendPing>[0]): () => void {
  if (!telemetryEnabled()) return () => {};
  const first = Number(process.env.HOSTPOG_TELEMETRY_FIRST_DELAY_MS ?? 60_000);
  const t1 = setTimeout(() => void sendPing(log), first);
  const t2 = setInterval(() => void sendPing(log), DAY_MS);
  t1.unref();
  t2.unref();
  log.info({}, "anonymous telemetry on (HOSTPOG_TELEMETRY=0 turns it off)");
  return () => {
    clearTimeout(t1);
    clearInterval(t2);
  };
}
