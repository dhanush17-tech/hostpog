import { dashboards, getDb } from "@hostpog/db";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { requireProject } from "@/server/authz";
import { body, ok, route } from "@/server/http";

type Ctx = { params: Promise<{ projectId: string }> };

export const GET = route<Ctx>(async (_req, { params }) => {
  const { projectId } = await params;
  await requireProject(projectId);
  return ok({ dashboards: await getDb().select().from(dashboards).where(eq(dashboards.projectId, projectId)).orderBy(desc(dashboards.updatedAt)) });
});

export const POST = route<Ctx>(async (req, { params }) => {
  const { projectId } = await params;
  const a = await requireProject(projectId, "member", req);
  const b = await body(req, z.object({ name: z.string().min(1).max(120) }));
  const [d] = await getDb().insert(dashboards).values({ projectId, name: b.name, createdBy: a.user.id }).returning();
  return ok({ dashboard: d }, { status: 201 });
});
