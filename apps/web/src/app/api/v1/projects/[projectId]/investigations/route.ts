import { getDb, investigations } from "@hostpog/db";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/server/audit";
import { requireProject } from "@/server/authz";
import { body, ok, route } from "@/server/http";
import { startInvestigation } from "@/server/investigations";

/** Investigations keep running after the response (see `after` in startInvestigation); allow up to 5 minutes. */
export const maxDuration = 300;

type Ctx = { params: Promise<{ projectId: string }> };

export const GET = route<Ctx>(async (_req, { params }) => {
  const { projectId } = await params;
  await requireProject(projectId);
  const rows = await getDb()
    .select({ id: investigations.id, title: investigations.title, status: investigations.status, model: investigations.model, createdAt: investigations.createdAt, sourceId: investigations.sourceId })
    .from(investigations)
    .where(eq(investigations.projectId, projectId))
    .orderBy(desc(investigations.createdAt))
    .limit(100);
  return ok({ investigations: rows });
});

const Input = z.object({
  question: z.string().min(5).max(2000),
  providerId: z.string().uuid(),
  sourceId: z.string().uuid().nullish(),
});

export const POST = route<Ctx>(async (req, { params }) => {
  const { projectId } = await params;
  const a = await requireProject(projectId, "member", req);
  const b = await body(req, Input);
  const row = await startInvestigation(a, b);
  await audit({ workspaceId: a.workspace.id, projectId, actorUserId: a.user.id, action: "investigation.start", target: row.id, meta: { providerId: b.providerId }, req });
  return ok({ investigation: row }, { status: 202 });
});
