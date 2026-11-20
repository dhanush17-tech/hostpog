import { getDb, projects, sources } from "@hostpog/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/server/audit";
import { requireProject } from "@/server/authz";
import { body, HttpError, ok, route } from "@/server/http";

type Ctx = { params: Promise<{ projectId: string }> };

export const GET = route<Ctx>(async (_req, { params }) => {
  const { projectId } = await params;
  const a = await requireProject(projectId);
  return ok({ project: a.project, workspace: { id: a.workspace.id, name: a.workspace.name }, role: a.role });
});

const Patch = z.object({
  name: z.string().min(1).max(80).optional(),
  timezone: z.string().max(64).refine((tz) => {
    try {
      new Intl.DateTimeFormat("en", { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, "unknown timezone").optional(),
  primarySourceId: z.string().uuid().optional(),
});

export const PATCH = route<Ctx>(async (req, { params }) => {
  const { projectId } = await params;
  const a = await requireProject(projectId, "admin", req);
  const b = await body(req, Patch);
  if (b.primarySourceId) {
    const [s] = await getDb().select().from(sources).where(and(eq(sources.id, b.primarySourceId), eq(sources.projectId, projectId))).limit(1);
    if (!s) throw new HttpError(404, "Source not found");
  }
  const [p] = await getDb().update(projects).set(b).where(eq(projects.id, projectId)).returning();
  await audit({ workspaceId: a.workspace.id, projectId, actorUserId: a.user.id, action: "project.update", meta: b, req });
  return ok({ project: p });
});

export const DELETE = route<Ctx>(async (req, { params }) => {
  const { projectId } = await params;
  const a = await requireProject(projectId, "owner", req);
  await getDb().update(projects).set({ deletedAt: new Date() }).where(eq(projects.id, projectId));
  await audit({ workspaceId: a.workspace.id, projectId, actorUserId: a.user.id, action: "project.delete", req });
  return ok({ deleted: true });
});
