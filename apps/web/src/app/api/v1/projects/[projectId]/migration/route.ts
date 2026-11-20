import { getDb, ingestionKeys, migrations, sources, type PostHogSourceConfig } from "@hostpog/db";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/server/audit";
import { requireProject } from "@/server/authz";
import { body, ok, route } from "@/server/http";
import { checkProducts, checklist, cutover, getMigration, isJobRunning, listJobs, rollback,
  removeMigration, setupMigration } from "@/server/migration";

type Ctx = { params: Promise<{ projectId: string }> };

export const GET = route<Ctx>(async (_req, { params }) => {
  const { projectId } = await params;
  const a = await requireProject(projectId);
  const db = getDb();
  const ph = (await db.select().from(sources).where(and(eq(sources.projectId, projectId), eq(sources.kind, "posthog")))).find((s) => s.status !== "disconnected") ?? null;
  const m = await getMigration(projectId);
  if (!m) {
    return ok({
      migration: null,
      posthog: ph ? { id: ph.id, label: ph.label, region: (ph.config as unknown as PostHogSourceConfig).region } : null,
      ingestUrl: process.env.HOSTPOG_INGEST_PUBLIC_URL ?? "http://localhost:3001",
    });
  }
  const jobs = await listJobs(m.id);
  const [key] = await db.select().from(ingestionKeys).where(and(eq(ingestionKeys.sourceId, m.nativeSourceId), isNull(ingestionKeys.revokedAt))).limit(1);
  const cfg = ph ? (ph.config as unknown as PostHogSourceConfig) : null;
  return ok({
    migration: m,
    role: a.role,
    posthog: ph ? { id: ph.id, label: ph.label, region: cfg?.region, host: cfg?.host } : null,
    nativeSourceId: m.nativeSourceId,
    hostpogKey: key?.publicKey ?? null,
    ingestUrl: process.env.HOSTPOG_INGEST_PUBLIC_URL ?? "http://localhost:3001",
    uiHost: cfg?.host ?? "https://us.posthog.com",
    jobs: jobs.map((j) => ({ ...j, running: isJobRunning(j) })),
    checklist: await checklist(m, jobs, null),
  });
});

const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("setup"), projectToken: z.string().max(200).optional() }),
  z.object({ action: z.literal("check_products") }),
  z.object({ action: z.literal("set_forwarding"), value: z.boolean() }),
  z.object({ action: z.literal("acknowledge_gap"), key: z.string().max(60), value: z.boolean() }),
  z.object({ action: z.literal("cutover"), confirm: z.boolean().default(false) }),
  z.object({ action: z.literal("rollback") }),
  z.object({ action: z.literal("remove") }),
]);

export const POST = route<Ctx>(async (req, { params }) => {
  const { projectId } = await params;
  const a = await requireProject(projectId, "admin", req);
  const b = await body(req, Action);
  const db = getDb();
  switch (b.action) {
    case "setup":
      return ok({ migration: await setupMigration(a, req, b.projectToken?.trim() || undefined) });
    case "check_products":
      return ok({ report: await checkProducts(a) });
    case "set_forwarding": {
      const m = await getMigration(projectId);
      if (!m) return ok({ migration: null });
      await db.update(migrations).set({ forwarding: b.value, updatedAt: new Date() }).where(eq(migrations.id, m.id));
      await audit({ workspaceId: a.workspace.id, projectId, actorUserId: a.user.id, action: "migration.forwarding", target: m.id, meta: { value: b.value }, req });
      return ok({ forwarding: b.value });
    }
    case "acknowledge_gap": {
      const m = await getMigration(projectId);
      if (!m) return ok({});
      const set = new Set(m.acknowledgedGaps);
      if (b.value) set.add(b.key);
      else set.delete(b.key);
      await db.update(migrations).set({ acknowledgedGaps: [...set], updatedAt: new Date() }).where(eq(migrations.id, m.id));
      await audit({ workspaceId: a.workspace.id, projectId, actorUserId: a.user.id, action: "migration.acknowledge_gap", target: m.id, meta: { key: b.key, value: b.value }, req });
      return ok({ acknowledgedGaps: [...set] });
    }
    case "cutover":
      return ok(await cutover(a, req, { confirm: b.confirm }));
    case "rollback":
      await rollback(a, req);
      return ok({ rolledBack: true });
    case "remove":
      await removeMigration(a, req);
      return ok({ removed: true });
  }
});
