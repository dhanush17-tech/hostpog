/**
 * Native ingestion pipeline: validate -> redact -> dedupe -> resolve identity -> write.
 *
 * Delivery is at-least-once from SDKs. Duplicate protection is two-layered:
 *  1. a short-lived claim per (project, uuid) in the dedup store (Redis in prod),
 *     released again if the write fails so client retries still land;
 *  2. ReplacingMergeTree on (project_id, day, event, uuid) + FINAL at query time.
 * Client telemetry is untrusted: never used for authorization or billing.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { IngestEvent, MAX_EVENT_BYTES } from "@hostpog/contracts";
import type { Db } from "@hostpog/db";
import { createAnonymousPersons, importPerson, knownDistinctIds, resolveIdentity, type ImportedPersonInput } from "./identity";

export interface DedupStore {
  /** true when this key was not seen before (and is now claimed) */
  claim(key: string, ttlSeconds: number): Promise<boolean>;
  release(key: string): Promise<void>;
}

export class MemoryDedupStore implements DedupStore {
  private m = new Map<string, number>();
  async claim(key: string, ttl: number) {
    const now = Date.now();
    const exp = this.m.get(key);
    if (exp && exp > now) return false;
    this.m.set(key, now + ttl * 1000);
    if (this.m.size > 200_000) for (const [k, e] of this.m) if (e < now) this.m.delete(k);
    return true;
  }
  async release(key: string) {
    this.m.delete(key);
  }
}

/**
 * Per-process memory of distinct ids that already have a person in Postgres (and in the event-store mirror).
 * Plain events from known ids skip the identity transaction entirely: that transaction holds a per-project lock,
 * so running it for every event serialised all ingestion for a project.
 */
export class KnownIdCache {
  private m = new Map<string, { exp: number; setOnce: Set<string> }>();
  constructor(
    private ttlMs = 15 * 60_000,
    private max = 500_000,
  ) {}
  get(partition: string, id: string) {
    const v = this.m.get(`${partition}\u0000${id}`);
    if (!v) return undefined;
    if (v.exp < Date.now()) {
      this.m.delete(`${partition}\u0000${id}`);
      return undefined;
    }
    return v;
  }
  add(partition: string, id: string, setOnceKeys: Iterable<string> = []) {
    const k = `${partition}\u0000${id}`;
    const v = this.m.get(k) ?? { exp: 0, setOnce: new Set<string>() };
    v.exp = Date.now() + this.ttlMs;
    for (const s of setOnceKeys) v.setOnce.add(s);
    this.m.set(k, v);
    if (this.m.size > this.max) {
      // drop the oldest ~10% (Map keeps insertion order)
      let n = Math.floor(this.max / 10);
      for (const key of this.m.keys()) {
        this.m.delete(key);
        if (--n <= 0) break;
      }
    }
  }
  /** forget a whole partition (e.g. after "delete stored data") */
  clearPartition(partition: string) {
    for (const k of this.m.keys()) if (k.startsWith(`${partition}\u0000`)) this.m.delete(k);
  }
}
export const defaultKnownIds = new KnownIdCache();

export interface IngestContext {
  db: Db;
  ch: ClickHouseClient;
  dedup: DedupStore;
  /** storage partition id — the HostPog source id that owns the data (never the HostPog project id) */
  partitionId: string;
  sourceId: string;
  now?: Date;
  importJobId?: string;
  /** imports keep original timestamps even when far in the past */
  allowHistorical?: boolean;
  /** override the process-wide known-id cache (tests) */
  knownIds?: KnownIdCache;
  /** called with the stored event rows after a successful write (workflow triggers); must not throw */
  onAccepted?: (rows: Record<string, unknown>[]) => void;
}

export interface IngestOutcome {
  accepted: number;
  duplicates: number;
  rejected: { index: number; reason: string }[];
  warnings: string[];
}

const SENSITIVE_KEY = /(pass(word|wd)?|secret|token|authorization|api[_-]?key|card[_-]?(number|no)|cvv|cvc|ssn)/i;
const SENSITIVE_QUERY = /([?&])(token|code|password|secret|key|auth|session|signature|sig)=[^&#]*/gi;

export function redactProperties(props: Record<string, unknown>): {
  props: Record<string, unknown>;
  redacted: number;
} {
  let redacted = 0;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) {
    if (SENSITIVE_KEY.test(k) && !k.startsWith("$")) {
      redacted++;
      continue;
    }
    if (typeof v === "string" && (k === "$current_url" || k === "$referrer")) {
      out[k] = v.replace(SENSITIVE_QUERY, "$1$2=[redacted]");
    } else {
      out[k] = v;
    }
  }
  return { props: out, redacted };
}

export function flattenProps(props: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined) continue;
    if (k.length > 200) continue;
    out[k] = typeof v === "string" ? v.slice(0, 4096) : typeof v === "object" ? JSON.stringify(v).slice(0, 4096) : String(v);
  }
  return out;
}

let versionCounter = 0;
export function nextVersion(): string {
  versionCounter = (versionCounter + 1) % 1000;
  return (BigInt(Date.now()) * 1000n + BigInt(versionCounter)).toString();
}

function chTime(d: Date): string {
  return d.toISOString().replace("T", " ").replace("Z", "");
}

export async function ingestBatch(raw: unknown[], ctx: IngestContext): Promise<IngestOutcome> {
  const now = ctx.now ?? new Date();
  const outcome: IngestOutcome = {
    accepted: 0,
    duplicates: 0,
    rejected: [],
    warnings: [],
  };
  const eventRows: Record<string, unknown>[] = [];
  const pdiRows: Record<string, unknown>[] = [];
  const propRows: Record<string, unknown>[] = [];
  const claimed: string[] = [];
  const known = ctx.knownIds ?? defaultKnownIds;
  const isPlain = (e: { event?: unknown; properties?: unknown }) => {
    const p = (e.properties ?? {}) as Record<string, unknown>;
    return e.event !== "$identify" && e.event !== "$create_alias" && !p.$set;
  };

  // Plain events (not identify/alias, no $set): look up unknown distinct ids in one query, then create persons for
  // the genuinely new ones in one locked transaction. Only identify/alias/$set events take the per-event path.
  const firstSeen = new Map<string, { seenAt: Date; setOnce?: Record<string, unknown> }>();
  for (const item of raw) {
    const e = item as { event?: unknown; distinct_id?: unknown; timestamp?: unknown; properties?: unknown } | null;
    if (!e || typeof e.distinct_id !== "string" || !e.distinct_id || !isPlain(e) || known.get(ctx.partitionId, e.distinct_id)) continue;
    const ts = typeof e.timestamp === "string" ? new Date(e.timestamp) : now;
    const seenAt = Number.isNaN(ts.getTime()) || ts > now ? now : ts;
    const so = (e.properties as Record<string, unknown> | undefined)?.$set_once;
    const setOnce = so && typeof so === "object" && !Array.isArray(so) ? (so as Record<string, unknown>) : undefined;
    const prev = firstSeen.get(e.distinct_id);
    if (!prev || seenAt < prev.seenAt) firstSeen.set(e.distinct_id, { seenAt, setOnce: prev?.setOnce ?? setOnce });
  }
  if (firstSeen.size) {
    const existing = new Set(await knownDistinctIds(ctx.db, ctx.partitionId, [...firstSeen.keys()]));
    for (const id of existing) known.add(ctx.partitionId, id);
    const fresh = [...firstSeen].filter(([id]) => !existing.has(id)).map(([distinctId, v]) => ({ distinctId, ...v }));
    for (const r of await createAnonymousPersons(ctx.db, ctx.partitionId, fresh)) {
      known.add(ctx.partitionId, r.distinctId, Object.keys(r.properties));
      if (!r.created) continue;
      pdiRows.push({ project_id: ctx.partitionId, distinct_id: r.distinctId, person_id: r.personId, version: nextVersion() });
      if (Object.keys(r.properties).length)
        propRows.push({ project_id: ctx.partitionId, person_id: r.personId, props: flattenProps(r.properties), version: nextVersion() });
    }
  }

  for (const [index, item] of raw.entries()) {
    let size = 0;
    try {
      size = JSON.stringify(item).length;
    } catch {
      outcome.rejected.push({ index, reason: "unserializable event" });
      continue;
    }
    if (size > MAX_EVENT_BYTES) {
      outcome.rejected.push({
        index,
        reason: `event exceeds ${MAX_EVENT_BYTES} bytes`,
      });
      continue;
    }
    const parsed = IngestEvent.safeParse(item);
    if (!parsed.success) {
      outcome.rejected.push({
        index,
        reason: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
      });
      continue;
    }
    const ev = parsed.data;
    let ts = ev.timestamp ? new Date(ev.timestamp) : now;
    if (ts.getTime() > now.getTime() + 3600_000) {
      outcome.warnings.push(`event ${index}: timestamp in the future, replaced with receive time`);
      ts = now;
    }
    if (!ctx.allowHistorical && ts.getTime() < now.getTime() - 2 * 365 * 86400_000) {
      outcome.rejected.push({
        index,
        reason: "timestamp older than two years (use an import job)",
      });
      continue;
    }

    const dedupKey = `hp:dedup:${ctx.partitionId}:${ev.uuid}`;
    if (!(await ctx.dedup.claim(dedupKey, 86400))) {
      outcome.duplicates++;
      continue;
    }
    claimed.push(dedupKey);

    const { props, redacted } = redactProperties(ev.properties);
    if (redacted) outcome.warnings.push(`event ${index}: dropped ${redacted} sensitive-looking properties`);

    const isIdentify = ev.event === "$identify";
    const isAlias = ev.event === "$create_alias";
    const anon = isIdentify
      ? typeof props.$anon_distinct_id === "string"
        ? props.$anon_distinct_id
        : undefined
      : isAlias && typeof props.alias === "string"
        ? props.alias
        : undefined;
    const asObj = (v: unknown) => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined);
    const setOnce = asObj(props.$set_once);
    const cached = !isIdentify && !isAlias && !props.$set ? known.get(ctx.partitionId, ev.distinct_id) : undefined;
    const fast = cached && Object.keys(setOnce ?? {}).every((k) => cached.setOnce.has(k));
    if (!fast) {
      const identity = await resolveIdentity(ctx.db, {
        projectId: ctx.partitionId,
        distinctId: ev.distinct_id,
        anonDistinctId: anon,
        identify: isIdentify || isAlias,
        set: asObj(props.$set),
        setOnce: asObj(props.$set_once),
        seenAt: ts,
      });
      outcome.warnings.push(...identity.warnings.map((w) => `event ${index}: ${w}`));
      // Always re-assert the current mapping so a failed earlier mirror write self-heals.
      if (!identity.mappingChanges.some((c) => c.distinctId === ev.distinct_id)) {
        identity.mappingChanges.push({
          distinctId: ev.distinct_id,
          personId: identity.personId,
        });
      }
      for (const c of identity.mappingChanges) {
        pdiRows.push({
          project_id: ctx.partitionId,
          distinct_id: c.distinctId,
          person_id: c.personId,
          version: nextVersion(),
        });
      }
      for (const c of identity.propsChanges) {
        propRows.push({
          project_id: ctx.partitionId,
          person_id: c.personId,
          props: flattenProps(c.properties),
          version: nextVersion(),
        });
      }
      for (const c of identity.mappingChanges) known.add(ctx.partitionId, c.distinctId);
      known.add(ctx.partitionId, ev.distinct_id, Object.keys(setOnce ?? {}));
    }

    const sessionId = typeof props.$session_id === "string" ? props.$session_id : "";
    const lib = typeof props.$lib === "string" ? `${props.$lib}@${String(props.$lib_version ?? "")}` : "";
    eventRows.push({
      project_id: ctx.partitionId,
      source_id: ctx.sourceId,
      uuid: ev.uuid,
      event: ev.event,
      distinct_id: ev.distinct_id,
      timestamp: chTime(ts),
      received_at: chTime(now),
      session_id: sessionId.slice(0, 200),
      properties: JSON.stringify(props),
      props: flattenProps(props),
      sdk: lib.slice(0, 100),
      import_job_id: ctx.importJobId ?? "",
    });
  }

  try {
    if (pdiRows.length)
      await ctx.ch.insert({
        table: "person_distinct_ids",
        values: pdiRows,
        format: "JSONEachRow",
      });
    if (propRows.length)
      await ctx.ch.insert({
        table: "person_props",
        values: propRows,
        format: "JSONEachRow",
      });
    if (eventRows.length)
      await ctx.ch.insert({
        table: "events",
        values: eventRows,
        format: "JSONEachRow",
      });
  } catch (err) {
    // allow client retries to succeed
    await Promise.all(claimed.map((k) => ctx.dedup.release(k)));
    throw err;
  }
  if (ctx.onAccepted && eventRows.length) ctx.onAccepted(eventRows);
  outcome.accepted = eventRows.length;
  return outcome;
}

/** Import person profiles (identity grouping + properties) and mirror them to ClickHouse. */
export async function ingestPersons(persons: Omit<ImportedPersonInput, "partitionId">[], ctx: Pick<IngestContext, "db" | "ch" | "partitionId">) {
  const pdiRows: Record<string, unknown>[] = [];
  const propRows: Record<string, unknown>[] = [];
  let created = 0;
  const warnings: string[] = [];
  for (const p of persons) {
    const r = await importPerson(ctx.db, {
      ...p,
      partitionId: ctx.partitionId,
    });
    if (r.created) created++;
    warnings.push(...r.warnings);
    for (const c of r.mappingChanges)
      pdiRows.push({
        project_id: ctx.partitionId,
        distinct_id: c.distinctId,
        person_id: c.personId,
        version: nextVersion(),
      });
    for (const c of r.propsChanges)
      propRows.push({
        project_id: ctx.partitionId,
        person_id: c.personId,
        props: flattenProps(c.properties),
        version: nextVersion(),
      });
  }
  if (pdiRows.length)
    await ctx.ch.insert({
      table: "person_distinct_ids",
      values: pdiRows,
      format: "JSONEachRow",
    });
  if (propRows.length)
    await ctx.ch.insert({
      table: "person_props",
      values: propRows,
      format: "JSONEachRow",
    });
  return { created, mapped: pdiRows.length, warnings };
}
