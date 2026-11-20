import { getDb, surveys } from "@hostpog/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireProject } from "@/server/authz";
import { body, ok, route } from "@/server/http";
import { getSurvey, SurveyInput, surveyResults } from "@/server/products";

type Ctx = { params: Promise<{ projectId: string; surveyId: string }> };
const Patch = z.union([z.object({ action: z.enum(["launch", "stop", "resume"]) }), SurveyInput.partial()]);

export const GET = route<Ctx>(async (req, { params }) => {
  const { projectId, surveyId } = await params;
  const a = await requireProject(projectId, "viewer", req);
  const s = await getSurvey(projectId, surveyId);
  if (!s.startedAt) return ok({ survey: s, results: null });
  return ok({ survey: s, results: await surveyResults(a, surveyId, new URL(req.url).searchParams.get("source")) });
});

export const PATCH = route<Ctx>(async (req, { params }) => {
  const { projectId, surveyId } = await params;
  await requireProject(projectId, "member", req);
  const cur = await getSurvey(projectId, surveyId);
  const b = await body(req, Patch);
  const now = new Date();
  const set =
    "action" in b
      ? b.action === "stop"
        ? { status: "stopped" as const, endedAt: now }
        : { status: "active" as const, startedAt: cur.startedAt ?? now, endedAt: null }
      : { ...SurveyInput.parse({ ...cur, ...b }) };
  const [s] = await getDb().update(surveys).set({ ...set, updatedAt: now }).where(eq(surveys.id, surveyId)).returning();
  return ok({ survey: s });
});

export const DELETE = route<Ctx>(async (req, { params }) => {
  const { projectId, surveyId } = await params;
  await requireProject(projectId, "member", req);
  await getSurvey(projectId, surveyId);
  await getDb().delete(surveys).where(eq(surveys.id, surveyId));
  return ok({ deleted: true });
});
