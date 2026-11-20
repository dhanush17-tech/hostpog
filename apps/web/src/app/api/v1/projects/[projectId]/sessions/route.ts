import { requireProject } from "@/server/authz";
import { ok, route } from "@/server/http";
import { providerFor, resolveSource } from "@/server/sources";

type Ctx = { params: Promise<{ projectId: string }> };

export const GET = route<Ctx>(async (req, { params }) => {
  const { projectId } = await params;
  const a = await requireProject(projectId);
  const sp = new URL(req.url).searchParams;
  const src = await resolveSource(a, sp.get("sourceId"));
  const p = await providerFor(a, src);
  const [sessions, caps] = await Promise.all([p.listSessions({ limit: 100, personId: sp.get("personId") || undefined }, { signal: req.signal }), p.capabilities()]);
  return ok({ sessions, capabilities: caps });
});
