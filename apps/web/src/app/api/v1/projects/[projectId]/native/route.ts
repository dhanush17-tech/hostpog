import { getDb, ingestionKeys, projects, sources } from "@hostpog/db";
import { randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { audit } from "@/server/audit";
import { requireProject } from "@/server/authz";
import { ok, route } from "@/server/http";

type Ctx = { params: Promise<{ projectId: string }> };

/** Create (or return) the project's native source and a write-only ingestion key. */
export const POST = route<Ctx>(async (req, { params }) => {
  const { projectId } = await params;
  const a = await requireProject(projectId, "admin", req);
  const db = getDb();
  let [src] = await db.select().from(sources).where(and(eq(sources.projectId, projectId), eq(sources.kind, "native"), eq(sources.status, "active"))).limit(1);
  let created = false;
  if (!src) {
    [src] = await db.insert(sources).values({ projectId, kind: "native", label: "HostPog SDK", status: "active" }).returning();
    created = true;
    if (!a.project.primarySourceId) await db.update(projects).set({ primarySourceId: src!.id }).where(eq(projects.id, projectId));
  }
  let [key] = await db.select().from(ingestionKeys).where(eq(ingestionKeys.sourceId, src!.id)).limit(1);
  if (!key || key.revokedAt) {
    [key] = await db.insert(ingestionKeys).values({ projectId, sourceId: src!.id, publicKey: `hp_pk_${randomBytes(18).toString("base64url")}` }).returning();
  }
  if (created) await audit({ workspaceId: a.workspace.id, projectId, actorUserId: a.user.id, action: "source.create_native", target: src!.id, req });
  return ok({
    source: { id: src!.id, label: src!.label },
    publicKey: key!.publicKey,
    ingestUrl: process.env.HOSTPOG_INGEST_PUBLIC_URL ?? "http://localhost:3001",
  });
});
