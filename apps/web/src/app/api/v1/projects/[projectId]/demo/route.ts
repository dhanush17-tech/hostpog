import { getDb, sources } from "@hostpog/db";
import { generateDemoEvents, generateDemoLogs, getClickHouse, ingestBatch, insertLogs, MemoryDedupStore, migrateClickHouse } from "@hostpog/native";
import { and, eq } from "drizzle-orm";
import { audit } from "@/server/audit";
import { requireProject } from "@/server/authz";
import { ok, route } from "@/server/http";

export const maxDuration = 300;

type Ctx = { params: Promise<{ projectId: string }> };

/**
 * Seeds a clearly labelled SYNTHETIC demo source with one planted regression.
 * It lives in its own partition and is never mixed with live sources.
 */
export const POST = route<Ctx>(async (req, { params }) => {
  const { projectId } = await params;
  const a = await requireProject(projectId, "member", req);
  const db = getDb();
  const [existing] = await db.select().from(sources).where(and(eq(sources.projectId, projectId), eq(sources.kind, "demo"), eq(sources.status, "active"))).limit(1);
  if (existing) return ok({ source: existing, seeded: false });
  await migrateClickHouse();
  const [src] = await db.insert(sources).values({ projectId, kind: "demo", label: "Demo data (synthetic)", status: "active", config: { seed: 42 } }).returning();
  let accepted = 0;
  if (process.env.HOSTPOG_JOB_RUNNER === "worker") {
    // Hosted: seed on the ingest server, next to Postgres (thousands of identity writes are too slow from a serverless region).
    const base = process.env.HOSTPOG_INGEST_INTERNAL_URL ?? process.env.HOSTPOG_INGEST_PUBLIC_URL;
    const res = await fetch(`${base}/internal/demo`, {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.HOSTPOG_INTERNAL_TOKEN}`, "content-type": "application/json" },
      body: JSON.stringify({ sourceId: src!.id }),
      signal: AbortSignal.timeout(240_000),
    }).catch((e: Error) => ({ ok: false, status: 0, json: async () => ({ error: e.message }) }) as const);
    const out = (await res.json().catch(() => ({}))) as { events?: number; error?: string };
    if (!res.ok) {
      await db.delete(sources).where(eq(sources.id, src!.id));
      throw new Error(`Couldn't load sample data (${out.error ?? res.status}). Try again in a minute.`);
    }
    accepted = out.events ?? 0;
  } else {
    const events = generateDemoEvents({ seed: 42 });
    const dedup = new MemoryDedupStore();
    for (let i = 0; i < events.length; i += 500) {
      const out = await ingestBatch(events.slice(i, i + 500), { db, ch: getClickHouse(), dedup, partitionId: src!.id, sourceId: src!.id, allowHistorical: true });
      accepted += out.accepted;
    }
    await insertLogs(getClickHouse(), generateDemoLogs(src!.id)).catch(() => undefined);
  }
  await audit({ workspaceId: a.workspace.id, projectId, actorUserId: a.user.id, action: "source.create_demo", target: src!.id, meta: { events: accepted }, req });
  return ok({ source: src, seeded: true, events: accepted }, { status: 201 });
});
