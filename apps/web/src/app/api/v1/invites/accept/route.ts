import { z } from "zod";
import { assertSameOrigin, requireUser } from "@/server/authz";
import { body, ok, route } from "@/server/http";
import { acceptInvite } from "@/server/invites";

export const POST = route(async (req: Request) => {
  assertSameOrigin(req);
  const u = await requireUser();
  const b = await body(req, z.object({ token: z.string().min(20).max(64) }));
  const r = await acceptInvite(b.token, u, req);
  return ok({ projectId: r.projectId, workspaceId: r.workspaceId });
});
