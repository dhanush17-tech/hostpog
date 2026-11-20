import { getDb, workflows } from "@hostpog/db";
import { eq } from "drizzle-orm";
import { requireProject } from "@/server/authz";
import { body, ok, route } from "@/server/http";
import { getWorkflow, WorkflowInput, workflowRunsFor } from "@/server/products";

type Ctx = { params: Promise<{ projectId: string; workflowId: string }> };

export const GET = route<Ctx>(async (req, { params }) => {
  const { projectId, workflowId } = await params;
  await requireProject(projectId, "viewer", req);
  return ok({ workflow: await getWorkflow(projectId, workflowId), runs: await workflowRunsFor(workflowId) });
});

export const PATCH = route<Ctx>(async (req, { params }) => {
  const { projectId, workflowId } = await params;
  await requireProject(projectId, "member", req);
  const cur = await getWorkflow(projectId, workflowId);
  const b = await body(req, WorkflowInput.partial());
  const next = WorkflowInput.parse({ name: cur.name, enabled: cur.enabled, trigger: cur.trigger, action: cur.action, ...b });
  const [w] = await getDb().update(workflows).set({ ...next, updatedAt: new Date() }).where(eq(workflows.id, workflowId)).returning();
  return ok({ workflow: w });
});

export const DELETE = route<Ctx>(async (req, { params }) => {
  const { projectId, workflowId } = await params;
  await requireProject(projectId, "member", req);
  await getWorkflow(projectId, workflowId);
  await getDb().delete(workflows).where(eq(workflows.id, workflowId));
  return ok({ deleted: true });
});
