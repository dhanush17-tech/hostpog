import { listAccessible, requireUser } from "@/server/authz";
import { ok, route } from "@/server/http";

export const GET = route(async () => {
  const user = await requireUser();
  return ok({ user, workspaces: await listAccessible(user.id) });
});
