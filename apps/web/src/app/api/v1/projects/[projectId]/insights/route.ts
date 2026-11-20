import { AnalyticsQuery } from "@hostpog/contracts";
import { getDb, insights, sources } from "@hostpog/db";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { requireProject } from "@/server/authz";
import { body, HttpError, ok, route } from "@/server/http";

type Ctx = { params: Promise<{ projectId: string }> };

export const GET = route<Ctx>(async (_req, { params }) => {
  const { projectId } = await params;
  await requireProject(projectId);
  const rows = await getDb().select().from(insights).where(eq(insights.projectId, projectId)).orderBy(desc(insights.updatedAt)).limit(200);
  return ok({ insights: rows });
});

const InsightInput = z.object({
  name: z.string().min(1).max(120),
  query: AnalyticsQuery,
  sourceId: z.string().uuid().nullish(),
});

export const POST = route<Ctx>(async (req, { params }) => {
  const { projectId } = await params;
  const a = await requireProject(projectId, "member", req);
  const b = await body(req, InsightInput);
  if (b.sourceId) {
    const [s] = await getDb().select().from(sources).where(and(eq(sources.id, b.sourceId), eq(sources.projectId, projectId))).limit(1);
    if (!s) throw new HttpError(404, "Source not found");
  }
  const [row] = await getDb()
    .insert(insights)
    .values({ projectId, name: b.name, query: b.query as unknown as Record<string, unknown>, sourceId: b.sourceId ?? null, createdBy: a.user.id })
    .returning();
  return ok({ insight: row }, { status: 201 });
});
