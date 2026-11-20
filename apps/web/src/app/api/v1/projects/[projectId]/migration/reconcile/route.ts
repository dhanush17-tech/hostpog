import { requireProject } from "@/server/authz";
import { ok, route } from "@/server/http";
import { reconcile } from "@/server/migration";

type Ctx = { params: Promise<{ projectId: string }> };

export const GET = route<Ctx>(async (req, { params }) => {
  const { projectId } = await params;
  const a = await requireProject(projectId);
  const days = Math.min(Math.max(Number(new URL(req.url).searchParams.get("days") ?? 14), 1), 90);
  return ok(await reconcile(a, days));
});
