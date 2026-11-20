import { AnalyticsQuery } from "@hostpog/contracts";
import { getDb, insights } from "@hostpog/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireProject } from "@/server/authz";
import { body, HttpError, ok, route } from "@/server/http";

type Ctx = { params: Promise<{ projectId: string; insightId: string }> };

const Patch = z.object({ name: z.string().min(1).max(120).optional(), query: AnalyticsQuery.optional() });

export const PATCH = route<Ctx>(async (req, { params }) => {
  const { projectId, insightId } = await params;
  await requireProject(projectId, "member", req);
  const b = await body(req, Patch);
  const [row] = await getDb()
    .update(insights)
    .set({ ...(b.name ? { name: b.name } : {}), ...(b.query ? { query: b.query as unknown as Record<string, unknown> } : {}), updatedAt: new Date() })
    .where(and(eq(insights.id, insightId), eq(insights.projectId, projectId)))
    .returning();
  if (!row) throw new HttpError(404, "Insight not found");
  return ok({ insight: row });
});

export const DELETE = route<Ctx>(async (req, { params }) => {
  const { projectId, insightId } = await params;
  await requireProject(projectId, "member", req);
  const res = await getDb().delete(insights).where(and(eq(insights.id, insightId), eq(insights.projectId, projectId))).returning({ id: insights.id });
  if (!res.length) throw new HttpError(404, "Insight not found");
  return ok({ deleted: true });
});
