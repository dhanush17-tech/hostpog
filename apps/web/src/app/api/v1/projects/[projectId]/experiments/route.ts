import { requireProject } from "@/server/authz";
import { body, ok, route } from "@/server/http";
import { createExperiment, ExperimentInput, listExperiments } from "@/server/products";

type Ctx = { params: Promise<{ projectId: string }> };

export const GET = route<Ctx>(async (req, { params }) => {
  const { projectId } = await params;
  await requireProject(projectId, "viewer", req);
  const rows = await listExperiments(projectId);
  return ok({ experiments: rows.map((r) => ({ ...r.e, flagKey: r.flagKey, variants: r.variants })) });
});

export const POST = route<Ctx>(async (req, { params }) => {
  const { projectId } = await params;
  const a = await requireProject(projectId, "member", req);
  return ok({ experiment: await createExperiment(a, req, await body(req, ExperimentInput)) }, { status: 201 });
});
