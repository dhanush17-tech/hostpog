import { requireProject } from "@/server/authz";
import { ok, route } from "@/server/http";
import { testWorkflow } from "@/server/products";

type Ctx = { params: Promise<{ projectId: string; workflowId: string }> };

/** Send a sample event through the workflow's action (delivered by the ingest server). */
export const POST = route<Ctx>(async (req, { params }) => {
  const { projectId, workflowId } = await params;
  await requireProject(projectId, "member", req);
  return ok({ run: await testWorkflow(projectId, workflowId) }, { status: 201 });
});
