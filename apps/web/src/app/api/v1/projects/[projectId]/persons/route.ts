import { PersonsQuery } from "@hostpog/contracts";
import { requireProject } from "@/server/authz";
import { ok, route } from "@/server/http";
import { providerFor, resolveSource } from "@/server/sources";

type Ctx = { params: Promise<{ projectId: string }> };

export const GET = route<Ctx>(async (req, { params }) => {
  const { projectId } = await params;
  const a = await requireProject(projectId);
  const sp = new URL(req.url).searchParams;
  const q = PersonsQuery.parse({
    kind: "persons",
    search: sp.get("search") || undefined,
    identified: sp.get("identified") === "true" ? true : sp.get("identified") === "false" ? false : undefined,
    limit: Number(sp.get("limit") ?? 50),
    cursor: sp.get("cursor") || undefined,
  });
  const p = await providerFor(a, await resolveSource(a, sp.get("sourceId")));
  return ok(await p.listPersons(q, { signal: req.signal }));
});
