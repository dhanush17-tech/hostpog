import { requireProject } from "@/server/authz";
import { body, ok, route } from "@/server/http";
import { listSurveys, SurveyInput, createSurvey } from "@/server/products";

type Ctx = { params: Promise<{ projectId: string }> };

export const GET = route<Ctx>(async (req, { params }) => {
  const { projectId } = await params;
  await requireProject(projectId, "viewer", req);
  return ok({ surveys: await listSurveys(projectId) });
});

export const POST = route<Ctx>(async (req, { params }) => {
  const { projectId } = await params;
  const a = await requireProject(projectId, "member", req);
  const b = await body(req, SurveyInput);
  return ok({ survey: await createSurvey(a, req, b) }, { status: 201 });
});
