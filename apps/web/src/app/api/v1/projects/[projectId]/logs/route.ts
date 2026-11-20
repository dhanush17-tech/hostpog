import { requireProject } from "@/server/authz";
import { ok, route } from "@/server/http";
import { queryLogs } from "@/server/logs";

type Ctx = { params: Promise<{ projectId: string }> };

export const GET = route<Ctx>(async (req, { params }) => {
  const { projectId } = await params;
  const a = await requireProject(projectId, "viewer", req);
  return ok(await queryLogs(a, Object.fromEntries(new URL(req.url).searchParams)));
});
