import { requireProject } from "@/server/authz";
import { body, ok, route } from "@/server/http";
import { createFlag, FlagInput, listFlags } from "@/server/products";

type Ctx = { params: Promise<{ projectId: string }> };

export const GET = route<Ctx>(async (req, { params }) => {
  const { projectId } = await params;
  await requireProject(projectId, "viewer", req);
  return ok({ flags: await listFlags(projectId) });
});

export const POST = route<Ctx>(async (req, { params }) => {
  const { projectId } = await params;
  const a = await requireProject(projectId, "member", req);
  return ok({ flag: await createFlag(a, req, await body(req, FlagInput)) }, { status: 201 });
});
