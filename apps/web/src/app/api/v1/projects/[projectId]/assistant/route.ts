import { AssistantRequest, askAssistant } from "@/server/assistant";
import { requireProject } from "@/server/authz";
import { body, ok, route } from "@/server/http";

type Ctx = { params: Promise<{ projectId: string }> };

export const maxDuration = 300;

export const POST = route<Ctx>(async (req, { params }) => {
  const { projectId } = await params;
  const a = await requireProject(projectId, "viewer", req);
  return ok(await askAssistant(a, req, await body(req, AssistantRequest)));
});
