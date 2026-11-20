import { requireProject } from "@/server/authz";
import { body, ok, route } from "@/server/http";
import { listWorkflows, WorkflowInput, createWorkflow } from "@/server/products";

type Ctx = { params: Promise<{ projectId: string }> };

export const GET = route<Ctx>(async (req, { params }) => {
  const { projectId } = await params;
  await requireProject(projectId, "viewer", req);
  return ok({ workflows: await listWorkflows(projectId) });
});

export const POST = route<Ctx>(async (req, { params }) => {
  const { projectId } = await params;
  const a = await requireProject(projectId, "member", req);
  const b = await body(req, WorkflowInput);
  return ok({ workflow: await createWorkflow(a, req, b) }, { status: 201 });
});
