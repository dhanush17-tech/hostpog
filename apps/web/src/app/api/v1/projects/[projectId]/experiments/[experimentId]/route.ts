import { experiments, getDb } from "@hostpog/db";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireProject } from "@/server/authz";
import { body, ok, route } from "@/server/http";
import { experimentAction, experimentResults, getExperiment } from "@/server/products";

type Ctx = { params: Promise<{ projectId: string; experimentId: string }> };
const Patch = z.union([
  z.object({ action: z.enum(["start", "stop", "ship", "reset"]), variant: z.string().max(100).optional() }),
  z.object({ name: z.string().trim().min(1).max(200).optional(), hypothesis: z.string().max(2000).optional(), goalEvent: z.string().trim().min(1).max(200).optional() }),
]);

/** Experiment with live results (?source= picks the data source, like every chart). */
export const GET = route<Ctx>(async (req, { params }) => {
  const { projectId, experimentId } = await params;
  const a = await requireProject(projectId, "viewer", req);
  return ok(await experimentResults(a, experimentId, new URL(req.url).searchParams.get("source")));
});

export const PATCH = route<Ctx>(async (req, { params }) => {
  const { projectId, experimentId } = await params;
  const a = await requireProject(projectId, "member", req);
  const b = await body(req, Patch);
  if ("action" in b) return ok({ experiment: await experimentAction(a, req, experimentId, b.action, b.variant) });
  await getExperiment(projectId, experimentId);
  const [e] = await getDb().update(experiments).set({ ...b, updatedAt: new Date() }).where(eq(experiments.id, experimentId)).returning();
  return ok({ experiment: e });
});

export const DELETE = route<Ctx>(async (req, { params }) => {
  const { projectId, experimentId } = await params;
  await requireProject(projectId, "member", req);
  const { e } = await getExperiment(projectId, experimentId);
  await getDb().delete(experiments).where(eq(experiments.id, e.id));
  return ok({ deleted: true, note: "The experiment's flag was kept. Delete it from Feature flags if your code no longer uses it." });
});
