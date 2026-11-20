import { getDb, sources } from "@hostpog/db";
import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { getSessionUser, listAccessible } from "@/server/authz";
import { ensurePersonalWorkspace } from "@/server/invites";

export const dynamic = "force-dynamic";

/** Entry point after sign-in: onboarding for empty projects, overview otherwise. */
export default async function AppIndex() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  let ws = await listAccessible(user.id);
  if (!ws.length) {
    await ensurePersonalWorkspace(user);
    ws = await listAccessible(user.id);
  }
  const project = ws.flatMap((w) => w.projects)[0];
  if (!project) redirect("/app/onboarding");
  const has = await getDb().select({ id: sources.id }).from(sources).where(eq(sources.projectId, project.id)).limit(1);
  redirect(has.length ? `/app/p/${project.id}/overview` : `/app/onboarding?project=${project.id}`);
}
