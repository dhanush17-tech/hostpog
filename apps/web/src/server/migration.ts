import "server-only";
import { gunzipSync } from "node:zlib";
import { randomBytes } from "node:crypto";
import type { AnalyticsProvider } from "@hostpog/analytics";
import type { TrendResult, TopValuesResult } from "@hostpog/contracts";
import { getDb, importJobs, ingestionKeys, migrations, projects, sources, type PostHogSourceConfig } from "@hostpog/db";
import { getClickHouse, ingestBatch, ingestPersons, MemoryDedupStore } from "@hostpog/native";
import {
  API_IMPORT_MAX_EVENTS,
  captureHostsFor,
  estimateHistory,
  exportEventsPage,
  exportPersonsPage,
  PostHogClient,
  productUsage,
  projectToken,
} from "@hostpog/posthog";
import { and, desc, eq, isNull, ne } from "drizzle-orm";
import { audit } from "./audit";
import type { ProjectAccess } from "./authz";
import { HttpError } from "./http";
import { decryptCredential, invalidateSourceCache, providerFor, type SourceRow } from "./sources";

export type MigrationRow = typeof migrations.$inferSelect;
export type ImportJobRow = typeof importJobs.$inferSelect;

export async function getMigration(projectId: string) {
  const [m] = await getDb().select().from(migrations).where(eq(migrations.projectId, projectId)).limit(1);
  return m ?? null;
}

async function posthogSource(access: ProjectAccess, m?: MigrationRow | null): Promise<SourceRow> {
  const db = getDb();
  const rows = await db.select().from(sources).where(and(eq(sources.projectId, access.project.id), eq(sources.kind, "posthog")));
  const s = (m?.posthogSourceId && rows.find((r) => r.id === m.posthogSourceId)) || rows.find((r) => r.status !== "disconnected");
  if (!s || s.status === "disconnected") throw new HttpError(409, "Connect your PostHog project first.", "no_posthog");
  return s;
}

/** A raw PostHog client for the connected source (no HostPog query cache). */
async function clientFor(access: ProjectAccess, s: SourceRow) {
  const cfg = s.config as unknown as PostHogSourceConfig;
  if (!s.credentialId) throw new HttpError(424, "The PostHog credential was removed. Reconnect PostHog.", "credential_missing");
  const cred = await decryptCredential(access.workspace.id, s.credentialId);
  const token = cred.kind === "posthog_oauth" ? (JSON.parse(cred.secret) as { accessToken: string }).accessToken : cred.secret;
  return {
    cfg,
    client: new PostHogClient({
      host: cfg.host,
      auth: cred.kind === "posthog_oauth" ? { type: "oauth", accessToken: token } : { type: "api_key", key: token },
      credentialKey: `${cred.row.id}:${cred.row.rotatedAt?.getTime() ?? cred.row.createdAt.getTime()}`,
    }),
  };
}

/** Create (or return) the migration: native destination source, write key, verified PostHog token. */
export async function setupMigration(access: ProjectAccess, req: Request, manualToken?: string) {
  const db = getDb();
  const existing = await getMigration(access.project.id);
  const ph = await posthogSource(access, existing);
  const { cfg, client } = await clientFor(access, ph);

  let token: string | null = null;
  if (cfg.organizationId) token = await projectToken(client, cfg.organizationId, cfg.externalProjectId).catch(() => null);
  if (manualToken) {
    if (token && manualToken !== token) throw new HttpError(400, "That project token does not belong to the connected PostHog project.", "token_mismatch");
    token ??= manualToken;
  }
  if (!token) throw new HttpError(400, "Could not read the PostHog project token automatically. Paste it (Project settings → Project token, starts with phc_).", "token_required");
  if (!/^phc_[A-Za-z0-9_-]{10,}$/.test(token)) throw new HttpError(400, "PostHog project tokens start with phc_.", "token_format");

  // A PostHog project's events can only be routed to one HostPog project (ingest routes by token).
  const [clash] = await db.select({ projectId: migrations.projectId }).from(migrations).where(and(eq(migrations.posthogProjectToken, token), ne(migrations.projectId, access.project.id))).limit(1);
  if (clash)
    throw new HttpError(409, "This PostHog project is already being moved by another HostPog project. Continue there, or remove that migration first.", "token_in_use");

  if (existing) {
    await db.update(migrations).set({ posthogProjectToken: token, posthogSourceId: ph.id, updatedAt: new Date() }).where(eq(migrations.id, existing.id));
    return (await getMigration(access.project.id))!;
  }
  let [native] = await db.select().from(sources).where(and(eq(sources.projectId, access.project.id), eq(sources.kind, "native"), eq(sources.status, "active"))).limit(1);
  if (!native) {
    [native] = await db.insert(sources).values({ projectId: access.project.id, kind: "native", label: "HostPog", status: "active", config: { migratedFrom: ph.id } }).returning();
  }
  const [key] = await db.select().from(ingestionKeys).where(and(eq(ingestionKeys.sourceId, native!.id), isNull(ingestionKeys.revokedAt))).limit(1);
  if (!key) await db.insert(ingestionKeys).values({ projectId: access.project.id, sourceId: native!.id, publicKey: `hp_pk_${randomBytes(18).toString("base64url")}` });
  const hosts = captureHostsFor(cfg.region, cfg.host);
  const [m] = await db
    .insert(migrations)
    .values({ projectId: access.project.id, posthogSourceId: ph.id, nativeSourceId: native!.id, posthogProjectToken: token, ...hosts, forwarding: true })
    .returning();
  await audit({ workspaceId: access.workspace.id, projectId: access.project.id, actorUserId: access.user.id, action: "migration.setup", target: m!.id, req });
  return m!;
}

export async function checkProducts(access: ProjectAccess) {
  const m = await getMigration(access.project.id);
  const ph = await posthogSource(access, m);
  const { cfg, client } = await clientFor(access, ph);
  const report = await productUsage(client, cfg.externalProjectId, 30, AbortSignal.timeout(60_000));
  if (m) await getDb().update(migrations).set({ productUsage: report, updatedAt: new Date() }).where(eq(migrations.id, m.id));
  return report;
}

/* ---------------- Import jobs (in-process, checkpointed, resumable) ---------------- */

const runningJobs = new Map<string, AbortController>();
/** Hosted (serverless) deployments hand long jobs to the ingest server's worker instead of running them in-process. */
const workerMode = () => process.env.HOSTPOG_JOB_RUNNER === "worker";
export const isJobRunning = (job: Pick<ImportJobRow, "id" | "status">) =>
  workerMode() ? job.status === "queued" || job.status === "running" : runningJobs.has(job.id);
export async function cancelJob(job: Pick<ImportJobRow, "id" | "status">) {
  if (workerMode()) {
    if (job.status === "queued" || job.status === "running") await updateJob(job.id, { status: "cancelled", error: "Cancelled. Resume continues from the last checkpoint." });
    return;
  }
  runningJobs.get(job.id)?.abort();
}

async function updateJob(id: string, patch: Partial<typeof importJobs.$inferInsert>) {
  await getDb()
    .update(importJobs)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(importJobs.id, id));
}

export async function startApiImport(access: ProjectAccess, req: Request, range: { from: string; to: string }) {
  const m = await getMigration(access.project.id);
  if (!m) throw new HttpError(409, "Set up the migration first.", "no_migration");
  const db = getDb();
  const active = await db.select().from(importJobs).where(and(eq(importJobs.migrationId, m.id), eq(importJobs.status, "running")));
  const queued = workerMode() ? await db.select().from(importJobs).where(and(eq(importJobs.migrationId, m.id), eq(importJobs.status, "queued"))) : [];
  if ([...active, ...queued].some((j) => isJobRunning(j))) throw new HttpError(409, "An import is already running.", "import_running");
  const ph = await posthogSource(access, m);
  const { cfg, client } = await clientFor(access, ph);
  const est = await estimateHistory(client, cfg.externalProjectId, range.from, range.to, AbortSignal.timeout(30_000));
  const max = API_IMPORT_MAX_EVENTS();
  if (est.events > max) {
    throw new HttpError(
      413,
      `This range has ${est.events.toLocaleString()} events. Imports through PostHog's query API are limited to ${max.toLocaleString()} events to respect PostHog's rate limits — use a batch export (JSON lines) for larger histories.`,
      "use_batch_export",
      { estimate: est },
    );
  }
  const [job] = await db
    .insert(importJobs)
    .values({ migrationId: m.id, method: "api", status: workerMode() ? "queued" : "running", rangeFrom: new Date(range.from), rangeTo: new Date(range.to), estimatedRows: est.events, createdBy: access.user.id, startedAt: new Date(), config: { estimate: est } })
    .returning();
  await audit({ workspaceId: access.workspace.id, projectId: access.project.id, actorUserId: access.user.id, action: "migration.import_start", target: job!.id, meta: { method: "api", ...range, estimate: est.events }, req });
  if (!workerMode()) runApiImport(access, job!.id);
  return job!;
}

/** Resume a paused/failed/cancelled API import from its checkpoint. */
export async function resumeImport(access: ProjectAccess, jobId: string) {
  const [job] = await getDb().select().from(importJobs).where(eq(importJobs.id, jobId)).limit(1);
  if (!job || job.method !== "api") throw new HttpError(400, "Only API imports can be resumed; re-upload files instead.");
  if (isJobRunning(job)) return job;
  if (workerMode()) {
    await updateJob(jobId, { status: "queued", error: null });
    return { ...job, status: "queued" as const };
  }
  await updateJob(jobId, { status: "running", error: null });
  runApiImport(access, jobId);
  return job;
}

function runApiImport(access: ProjectAccess, jobId: string) {
  const ctl = new AbortController();
  runningJobs.set(jobId, ctl);
  void (async () => {
    const db = getDb();
    try {
      const [job] = await db.select().from(importJobs).where(eq(importJobs.id, jobId)).limit(1);
      const m = (await getMigration(access.project.id))!;
      const ph = await posthogSource(access, m);
      const { cfg, client } = await clientFor(access, ph);
      const ctx = { db, ch: getClickHouse(), dedup: new MemoryDedupStore(), partitionId: m.nativeSourceId, sourceId: m.nativeSourceId, allowHistorical: true, importJobId: jobId };
      let cursor = { ...(job!.cursor as Record<string, unknown>) };
      let phase = job!.phase;
      let counts = { events: job!.importedEvents, persons: job!.importedPersons, dup: job!.duplicateEvents, failed: job!.failedRows };

      if (phase === "persons") {
        let afterId = cursor.personsAfter as string | undefined;
        for (;;) {
          if (ctl.signal.aborted) throw new Error("cancelled");
          const page = await exportPersonsPage(client, cfg.externalProjectId, { afterId, limit: 1000, signal: ctl.signal });
          if (page.persons.length) {
            const r = await ingestPersons(
              page.persons.map((p) => ({ distinctIds: p.distinctIds, properties: p.properties, isIdentified: p.isIdentified, createdAt: p.createdAt ? new Date(p.createdAt) : null })),
              ctx,
            );
            counts.persons += page.persons.length;
            void r;
          }
          afterId = page.next ?? undefined;
          cursor = { ...cursor, personsAfter: afterId };
          await updateJob(jobId, { cursor, importedPersons: counts.persons });
          if (!page.next) break;
        }
        phase = "events";
        await updateJob(jobId, { phase });
      }

      if (phase === "events") {
        for (;;) {
          if (ctl.signal.aborted) throw new Error("cancelled");
          const page = await exportEventsPage(client, cfg.externalProjectId, {
            from: job!.rangeFrom.toISOString(),
            to: job!.rangeTo.toISOString(),
            afterMs: cursor.afterMs as number | undefined,
            afterUuid: cursor.afterUuid as string | undefined,
            limit: 5000,
            signal: ctl.signal,
          });
          if (page.events.length) {
            const out = await ingestBatch(page.events, ctx);
            counts = { ...counts, events: counts.events + out.accepted, dup: counts.dup + out.duplicates, failed: counts.failed + out.rejected.length };
            if (out.rejected.length) {
              const failures = [...((job!.failures as { at: string; reason: string }[]) ?? []), ...out.rejected.slice(0, 20).map((r) => ({ at: new Date().toISOString(), reason: r.reason }))].slice(-50);
              await updateJob(jobId, { failures });
            }
          }
          if (page.next) cursor = { ...cursor, afterMs: page.next.afterMs, afterUuid: page.next.afterUuid };
          await updateJob(jobId, { cursor, importedEvents: counts.events, duplicateEvents: counts.dup, failedRows: counts.failed });
          if (!page.next) break;
        }
      }
      await updateJob(jobId, { status: "complete", phase: "done", finishedAt: new Date() });
    } catch (e) {
      const cancelled = ctl.signal.aborted;
      await updateJob(jobId, { status: cancelled ? "cancelled" : "failed", error: cancelled ? "Cancelled — resume continues from the last checkpoint" : (e as Error).message.slice(0, 500) });
    } finally {
      runningJobs.delete(jobId);
    }
  })();
}

/**
 * Import a PostHog batch-export file (JSON lines, optionally gzip) — the events model:
 * uuid, event, distinct_id, person_id, properties, person_properties, timestamp, …
 * Person grouping is rebuilt from person_id; idempotent by uuid.
 */
export async function importExportFile(access: ProjectAccess, req: Request, file: { name: string; bytes: Buffer }) {
  const m = await getMigration(access.project.id);
  if (!m) throw new HttpError(409, "Set up the migration first.", "no_migration");
  const db = getDb();
  const isGzip = file.bytes[0] === 0x1f && file.bytes[1] === 0x8b;
  if (/\.parquet(\.\w+)?$/i.test(file.name)) throw new HttpError(415, "Parquet files are not supported yet — choose JSON lines when creating the PostHog batch export.", "parquet_unsupported");
  let text: string;
  try {
    text = (isGzip ? gunzipSync(file.bytes) : file.bytes).toString("utf8");
  } catch {
    throw new HttpError(400, "Could not decompress the file.");
  }
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  const [job] = await db
    .insert(importJobs)
    .values({ migrationId: m.id, method: "file", status: "running", phase: "events", rangeFrom: new Date(0), rangeTo: new Date(), estimatedRows: lines.length, createdBy: access.user.id, startedAt: new Date(), config: { file: file.name, bytes: file.bytes.length } })
    .returning();
  const ctx = { db, ch: getClickHouse(), dedup: new MemoryDedupStore(), partitionId: m.nativeSourceId, sourceId: m.nativeSourceId, allowHistorical: true, importJobId: job!.id };
  let imported = 0;
  let dup = 0;
  let failed = 0;
  const failures: { at: string; reason: string }[] = [];
  let minTs = Infinity;
  let maxTs = -Infinity;
  for (let i = 0; i < lines.length; i += 2000) {
    const chunk = lines.slice(i, i + 2000);
    const events: Record<string, unknown>[] = [];
    const persons = new Map<string, { ids: Set<string>; props: Record<string, unknown> }>();
    chunk.forEach((line, j) => {
      try {
        const r = JSON.parse(line) as Record<string, unknown>;
        const props = typeof r.properties === "string" ? JSON.parse(r.properties) : (r.properties ?? {});
        const ts = new Date(String(r.timestamp));
        if (!Number.isNaN(ts.getTime())) {
          minTs = Math.min(minTs, ts.getTime());
          maxTs = Math.max(maxTs, ts.getTime());
        }
        events.push({ uuid: r.uuid, event: r.event, distinct_id: String(r.distinct_id ?? ""), timestamp: ts.toISOString(), properties: props });
        if (r.person_id && r.distinct_id) {
          const pid = String(r.person_id);
          const entry = persons.get(pid) ?? { ids: new Set<string>(), props: {} };
          entry.ids.add(String(r.distinct_id));
          const pp = typeof r.person_properties === "string" ? JSON.parse(r.person_properties) : r.person_properties;
          if (pp && typeof pp === "object") entry.props = { ...entry.props, ...(pp as Record<string, unknown>) };
          persons.set(pid, entry);
        }
      } catch {
        failed++;
        if (failures.length < 50) failures.push({ at: `line ${i + j + 1}`, reason: "invalid JSON line" });
      }
    });
    if (persons.size) await ingestPersons([...persons.values()].map((p) => ({ distinctIds: [...p.ids], properties: p.props, isIdentified: true, createdAt: null })), ctx);
    const out = await ingestBatch(events, ctx);
    imported += out.accepted;
    dup += out.duplicates;
    failed += out.rejected.length;
    for (const r of out.rejected.slice(0, 50 - failures.length)) failures.push({ at: `line ${i + r.index + 1}`, reason: r.reason });
    await updateJob(job!.id, { importedEvents: imported, duplicateEvents: dup, failedRows: failed, failures });
  }
  await updateJob(job!.id, {
    status: "complete",
    phase: "done",
    finishedAt: new Date(),
    ...(Number.isFinite(minTs) ? { rangeFrom: new Date(minTs), rangeTo: new Date(maxTs) } : {}),
  });
  await audit({ workspaceId: access.workspace.id, projectId: access.project.id, actorUserId: access.user.id, action: "migration.import_file", target: job!.id, meta: { file: file.name, imported, failed }, req });
  const [done] = await db.select().from(importJobs).where(eq(importJobs.id, job!.id));
  return done!;
}

export async function listJobs(migrationId: string) {
  return getDb().select().from(importJobs).where(eq(importJobs.migrationId, migrationId)).orderBy(desc(importJobs.createdAt)).limit(20);
}

/* ---------------- Reconciliation ---------------- */

export interface ReconcileDay {
  day: string;
  posthog: { events: number; users: number };
  hostpog: { events: number; users: number };
  eventDiffPct: number | null;
  status: "match" | "mismatch" | "partial_day" | "empty";
}

const pct = (a: number, b: number) => (b === 0 ? (a === 0 ? 0 : null) : (a - b) / b);

export async function reconcile(access: ProjectAccess, days: number) {
  const m = await getMigration(access.project.id);
  if (!m) throw new HttpError(409, "Set up the migration first.", "no_migration");
  const ph = await posthogSource(access, m);
  const [native] = await getDb().select().from(sources).where(eq(sources.id, m.nativeSourceId)).limit(1);
  const tz = (ph.config as unknown as PostHogSourceConfig).timezone || "UTC";
  const access2 = { ...access, project: { ...access.project, timezone: tz } };
  const providers: [string, AnalyticsProvider][] = [
    ["posthog", await providerFor(access2, ph)],
    ["hostpog", await providerFor(access2, native!)],
  ];
  const dateRange = { from: `-${days}d`, to: "now" };
  const results = await Promise.all(
    providers.map(async ([name, p]) => {
      const trend = await p.query(
        { kind: "trend", series: [{ event: null, math: "total", filters: [] }, { event: null, math: "unique_users", filters: [] }], interval: "day", dateRange, compare: false, filters: [] },
        { timezone: tz },
      );
      const top = await p.query({ kind: "top", event: null, groupBy: { type: "event_name", key: "$event", limit: 25 }, dateRange, filters: [], limit: 25 }, { timezone: tz });
      return { name, trend: trend.result as TrendResult, top: top.result as TopValuesResult, env: trend };
    }),
  );
  const [P, H] = results as [(typeof results)[0], (typeof results)[0]];
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
  const dayRows: ReconcileDay[] = P.trend.series[0]!.points.map((pt, i) => {
    const pe = pt.v;
    const pu = P.trend.series[1]!.points[i]?.v ?? 0;
    const he = H.trend.series[0]!.points[i]?.v ?? 0;
    const hu = H.trend.series[1]!.points[i]?.v ?? 0;
    const d = pct(he, pe);
    const status: ReconcileDay["status"] = pt.t === today ? "partial_day" : pe === 0 && he === 0 ? "empty" : d !== null && Math.abs(d) <= 0.01 ? "match" : "mismatch";
    return { day: pt.t, posthog: { events: pe, users: pu }, hostpog: { events: he, users: hu }, eventDiffPct: d, status };
  });
  const names = new Set([...P.top.rows, ...H.top.rows].map((r) => r.value ?? "(none)"));
  const byEvent = [...names].map((name) => {
    const pc = P.top.rows.find((r) => (r.value ?? "(none)") === name)?.count ?? 0;
    const hc = H.top.rows.find((r) => (r.value ?? "(none)") === name)?.count ?? 0;
    return { event: name, posthog: pc, hostpog: hc, diffPct: pct(hc, pc) };
  });
  byEvent.sort((a, b) => b.posthog - a.posthog);
  const complete = dayRows.filter((d) => d.status === "match" || d.status === "mismatch");
  return {
    timezone: tz,
    days: dayRows,
    byEvent,
    summary: {
      checkedDays: complete.length,
      mismatchedDays: complete.filter((d) => d.status === "mismatch").length,
      posthogEvents: complete.reduce((a, d) => a + d.posthog.events, 0),
      hostpogEvents: complete.reduce((a, d) => a + d.hostpog.events, 0),
      tolerance: "±1% events per complete day",
    },
    computedAt: new Date().toISOString(),
  };
}

/* ---------------- Checklist & cutover ---------------- */

export interface ChecklistItem {
  key: string;
  label: string;
  done: boolean;
  detail: string;
  required: boolean;
}

export async function checklist(m: MigrationRow, jobs: ImportJobRow[], reconcileSummary?: { checkedDays: number; mismatchedDays: number } | null): Promise<ChecklistItem[]> {
  const blocking = (m.productUsage?.products ?? []).filter((p) => p.blocksCutover && p.inUse !== false && !m.acknowledgedGaps.includes(p.key));
  const importDone = jobs.some((j) => j.status === "complete");
  const recent = m.trackingLastSeenAt && Date.now() - m.trackingLastSeenAt.getTime() < 24 * 3600_000;
  return [
    { key: "connected", label: "PostHog connected read-only", done: true, detail: "Your existing data is visible in HostPog.", required: true },
    {
      key: "products",
      label: "Checked which PostHog products you use",
      done: Boolean(m.productUsage) && blocking.length === 0,
      detail: !m.productUsage ? "Run the product check." : blocking.length ? `Still in use and not available in HostPog yet: ${blocking.map((b) => b.label).join(", ")}.` : "Nothing you use is missing.",
      required: true,
    },
    {
      key: "tracking",
      label: "Your app sends events through HostPog",
      done: Boolean(recent),
      detail: m.trackingLastSeenAt ? `Last event via HostPog ${m.trackingLastSeenAt.toISOString()}.` : "Change api_host and deploy, then visit your app.",
      required: true,
    },
    { key: "history", label: "History imported", done: importDone, detail: importDone ? "At least one import completed." : "Import your PostHog history.", required: true },
    {
      key: "reconciled",
      label: "Counts match between HostPog and PostHog",
      done: Boolean(reconcileSummary && reconcileSummary.checkedDays > 0 && reconcileSummary.mismatchedDays === 0),
      detail: reconcileSummary ? `${reconcileSummary.checkedDays} complete days checked, ${reconcileSummary.mismatchedDays} mismatched.` : "Compare the numbers in step 4.",
      required: true,
    },
  ];
}

export async function cutover(access: ProjectAccess, req: Request, opts: { confirm: boolean }) {
  const m = await getMigration(access.project.id);
  if (!m) throw new HttpError(409, "Set up the migration first.", "no_migration");
  const jobs = await listJobs(m.id);
  const rec = await reconcile(access, 14).catch(() => null);
  const items = await checklist(m, jobs, rec?.summary);
  const missing = items.filter((i) => i.required && !i.done);
  if (missing.length && !opts.confirm) {
    throw new HttpError(409, `Not ready to cut over: ${missing.map((i) => i.label).join("; ")}.`, "not_ready", { checklist: items });
  }
  const db = getDb();
  await db.update(migrations).set({ forwarding: false, status: "cut_over", cutoverAt: new Date(), updatedAt: new Date() }).where(eq(migrations.id, m.id));
  await db.update(projects).set({ primarySourceId: m.nativeSourceId }).where(eq(projects.id, access.project.id));
  await audit({ workspaceId: access.workspace.id, projectId: access.project.id, actorUserId: access.user.id, action: "migration.cutover", target: m.id, meta: { overridden: missing.map((i) => i.key) }, req });
  return { checklist: items, overridden: missing.map((i) => i.key) };
}

export async function rollback(access: ProjectAccess, req: Request) {
  const m = await getMigration(access.project.id);
  if (!m) throw new HttpError(409, "No migration to roll back.");
  const db = getDb();
  await db.update(migrations).set({ forwarding: true, status: "in_progress", cutoverAt: null, updatedAt: new Date() }).where(eq(migrations.id, m.id));
  if (m.posthogSourceId) await db.update(projects).set({ primarySourceId: m.posthogSourceId }).where(eq(projects.id, access.project.id));
  if (m.posthogSourceId) invalidateSourceCache(access.workspace.id, m.posthogSourceId);
  await audit({ workspaceId: access.workspace.id, projectId: access.project.id, actorUserId: access.user.id, action: "migration.rollback", target: m.id, req });
}

/** Remove the migration record (stops /ph routing for its token). Imported HostPog data is kept. */
export async function removeMigration(access: ProjectAccess, req: Request) {
  const m = await getMigration(access.project.id);
  if (!m) return;
  if (m.status === "cut_over") throw new HttpError(409, "Roll back before removing a cut-over migration — your app is still sending events through it.", "migration_cut_over");
  const db = getDb();
  for (const j of await listJobs(m.id)) await cancelJob(j);
  await db.delete(importJobs).where(eq(importJobs.migrationId, m.id));
  await db.delete(migrations).where(eq(migrations.id, m.id));
  await audit({ workspaceId: access.workspace.id, projectId: access.project.id, actorUserId: access.user.id, action: "migration.remove", target: m.id, req });
}
