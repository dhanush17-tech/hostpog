/**
 * Background job worker (hosted mode: HOSTPOG_JOB_RUNNER=worker).
 *
 * Serverless web functions stop after their response (and at most a few minutes), so long jobs run here,
 * next to Postgres:
 *   - PostHog history imports: the web app inserts an import_jobs row (status "queued"); this worker claims it with
 *     a Postgres advisory lock, runs it from its saved cursor, and checkpoints after every page. A restart simply
 *     resumes. Setting status "cancelled" in the database stops it at the next page.
 *   - Sample data: POST /internal/demo (token-protected) seeds a demo source synchronously.
 */
import { timingSafeEqual } from "node:crypto";
import { credentialAad, credentials, decryptSecret, getDb, getSqlClient, importJobs, migrations, projects, sources, type PostHogSourceConfig } from "@hostpog/db";
import { generateDemoEvents, generateDemoLogs, getClickHouse, ingestBatch, ingestPersons, insertLogs, MemoryDedupStore } from "@hostpog/native";
import { exportEventsPage, exportPersonsPage, PostHogClient } from "@hostpog/posthog";
import { and, eq, inArray } from "drizzle-orm";

type Log = { info: (o: unknown, m?: string) => void; error: (o: unknown, m?: string) => void };

async function updateJob(id: string, patch: Partial<typeof importJobs.$inferInsert>) {
  await getDb()
    .update(importJobs)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(importJobs.id, id));
}

async function jobStatus(id: string) {
  const [j] = await getDb().select({ status: importJobs.status }).from(importJobs).where(eq(importJobs.id, id)).limit(1);
  return j?.status;
}

/** A PostHog client for the migration's connected PostHog source. */
async function posthogClientFor(migrationId: string) {
  const db = getDb();
  const [m] = await db.select().from(migrations).where(eq(migrations.id, migrationId)).limit(1);
  if (!m) throw new Error("Migration not found");
  const [proj] = await db.select().from(projects).where(eq(projects.id, m.projectId)).limit(1);
  const rows = await db.select().from(sources).where(and(eq(sources.projectId, m.projectId), eq(sources.kind, "posthog")));
  const s = (m.posthogSourceId && rows.find((r) => r.id === m.posthogSourceId)) || rows.find((r) => r.status !== "disconnected");
  if (!s || s.status === "disconnected") throw new Error("Connect your PostHog project first.");
  if (!s.credentialId) throw new Error("The PostHog credential was removed. Reconnect PostHog.");
  const [c] = await db
    .select()
    .from(credentials)
    .where(and(eq(credentials.id, s.credentialId), eq(credentials.workspaceId, proj!.workspaceId)))
    .limit(1);
  if (!c) throw new Error("The PostHog credential was removed. Reconnect PostHog.");
  const secret = decryptSecret(c.ciphertext, credentialAad(proj!.workspaceId, c.kind));
  const cfg = s.config as unknown as PostHogSourceConfig;
  const oauth = c.kind === "posthog_oauth";
  const token = oauth ? (JSON.parse(secret) as { accessToken: string }).accessToken : secret;
  return {
    m,
    cfg,
    client: new PostHogClient({
      host: cfg.host,
      auth: oauth ? { type: "oauth", accessToken: token } : { type: "api_key", key: token },
      credentialKey: `${c.id}:${c.rotatedAt?.getTime() ?? c.createdAt.getTime()}`,
    }),
  };
}

/** Run (or resume) one API import from its checkpoint. Mirrors apps/web/src/server/migration.ts runApiImport. */
export async function runApiImportJob(jobId: string, signal: AbortSignal) {
  const db = getDb();
  const [job] = await db.select().from(importJobs).where(eq(importJobs.id, jobId)).limit(1);
  if (!job) return;
  await updateJob(jobId, { status: "running", error: null });
  try {
    const { m, cfg, client } = await posthogClientFor(job.migrationId);
    const ctx = { db, ch: getClickHouse(), dedup: new MemoryDedupStore(), partitionId: m.nativeSourceId, sourceId: m.nativeSourceId, allowHistorical: true, importJobId: jobId };
    let cursor = { ...(job.cursor as Record<string, unknown>) };
    let phase = job.phase;
    let counts = { events: job.importedEvents, persons: job.importedPersons, dup: job.duplicateEvents, failed: job.failedRows };
    const stopIfCancelled = async () => {
      if (signal.aborted || (await jobStatus(jobId)) === "cancelled") throw new Error("cancelled");
    };

    if (phase === "persons") {
      let afterId = cursor.personsAfter as string | undefined;
      for (;;) {
        await stopIfCancelled();
        const page = await exportPersonsPage(client, cfg.externalProjectId, { afterId, limit: 1000, signal });
        if (page.persons.length) {
          await ingestPersons(
            page.persons.map((p) => ({ distinctIds: p.distinctIds, properties: p.properties, isIdentified: p.isIdentified, createdAt: p.createdAt ? new Date(p.createdAt) : null })),
            ctx,
          );
          counts.persons += page.persons.length;
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
        await stopIfCancelled();
        const page = await exportEventsPage(client, cfg.externalProjectId, {
          from: job.rangeFrom.toISOString(),
          to: job.rangeTo.toISOString(),
          afterMs: cursor.afterMs as number | undefined,
          afterUuid: cursor.afterUuid as string | undefined,
          limit: 5000,
          signal,
        });
        if (page.events.length) {
          const out = await ingestBatch(page.events, ctx);
          counts = { ...counts, events: counts.events + out.accepted, dup: counts.dup + out.duplicates, failed: counts.failed + out.rejected.length };
          if (out.rejected.length) {
            const failures = [...((job.failures as { at: string; reason: string }[]) ?? []), ...out.rejected.slice(0, 20).map((r) => ({ at: new Date().toISOString(), reason: r.reason }))].slice(-50);
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
    const msg = (e as Error).message;
    if (msg === "cancelled") {
      // shutdown (signal) leaves the job "running" so the next worker resumes it; a user cancel is already recorded
      if (!signal.aborted) await updateJob(jobId, { error: "Cancelled. Resume continues from the last checkpoint." });
    } else {
      await updateJob(jobId, { status: "failed", error: msg.slice(0, 500) });
    }
  }
}

/** Poll for queued/running API imports and run each one exactly once across worker instances. */
export function startJobWorker(log: Log, opts: { intervalMs?: number } = {}) {
  // Session-level advisory locks need a dedicated connection per running job (reserved from the shared pool).
  const lockSql = getSqlClient();
  const running = new Map<string, AbortController>();
  let stopped = false;

  const tick = async () => {
    if (stopped) return;
    try {
      const jobs = await getDb()
        .select({ id: importJobs.id })
        .from(importJobs)
        .where(and(eq(importJobs.method, "api"), inArray(importJobs.status, ["queued", "running"])));
      for (const { id } of jobs) {
        if (running.has(id) || running.size >= 2) continue;
        const conn = await lockSql.reserve();
        const [row] = await conn<{ ok: boolean }[]>`SELECT pg_try_advisory_lock(hashtext(${"hostpog-job:" + id})) AS ok`;
        if (!row?.ok) {
          conn.release();
          continue;
        }
        const ctl = new AbortController();
        running.set(id, ctl);
        log.info({ jobId: id }, "import job started");
        void runApiImportJob(id, ctl.signal)
          .catch((e) => log.error({ jobId: id, err: (e as Error).message }, "import job crashed"))
          .finally(async () => {
            running.delete(id);
            await conn`SELECT pg_advisory_unlock(hashtext(${"hostpog-job:" + id}))`.catch(() => {});
            conn.release();
            log.info({ jobId: id }, "import job finished");
          });
      }
    } catch (e) {
      log.error({ err: (e as Error).message }, "job poll failed");
    }
  };

  const timer = setInterval(() => void tick(), opts.intervalMs ?? 3000);
  void tick();
  return async () => {
    stopped = true;
    clearInterval(timer);
    for (const c of running.values()) c.abort();
  };
}

/** Seed the synthetic demo data set into an existing demo source. */
export async function seedDemo(sourceId: string) {
  const db = getDb();
  const [src] = await db.select().from(sources).where(eq(sources.id, sourceId)).limit(1);
  if (!src || src.kind !== "demo") throw new Error("demo source not found");
  const events = generateDemoEvents({ seed: 42 });
  const dedup = new MemoryDedupStore();
  let accepted = 0;
  for (let i = 0; i < events.length; i += 500) {
    const out = await ingestBatch(events.slice(i, i + 500), { db, ch: getClickHouse(), dedup, partitionId: src.id, sourceId: src.id, allowHistorical: true });
    accepted += out.accepted;
  }
  await insertLogs(getClickHouse(), generateDemoLogs(src.id)).catch(() => undefined);
  return accepted;
}

/** Constant-time check of the shared web↔ingest token. */
export function internalAuthOk(header: string | undefined) {
  const expected = process.env.HOSTPOG_INTERNAL_TOKEN;
  if (!expected || !header?.startsWith("Bearer ")) return false;
  const a = Buffer.from(header.slice(7));
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
