import { requireProject } from "@/server/authz";
import { HttpError, ok, route } from "@/server/http";
import { providerFor, resolveSource } from "@/server/sources";

type Ctx = { params: Promise<{ projectId: string; personId: string }> };

/** Person profile + chronological activity timeline + sessions (bounded). */
export const GET = route<Ctx>(async (req, { params }) => {
  const { projectId, personId } = await params;
  const a = await requireProject(projectId);
  const sp = new URL(req.url).searchParams;
  const p = await providerFor(a, await resolveSource(a, sp.get("sourceId")));
  const id = decodeURIComponent(personId).slice(0, 400);
  const person = await p.getPerson(id, { signal: req.signal });
  if (!person.result) throw new HttpError(404, "Person not found");
  const cursorTs = sp.get("cursorTs");
  const cursorUuid = sp.get("cursorUuid");
  const [events, sessions] = await Promise.all([
    p.query(
      {
        kind: "events",
        personId: person.result.id,
        dateRange: { from: "-90d", to: "now" },
        limit: 50,
        filters: [],
        ...(cursorTs && cursorUuid ? { cursor: { ts: cursorTs, uuid: cursorUuid } } : {}),
      },
      { signal: req.signal },
    ),
    p.listSessions({ personId: person.result.id, limit: 20 }, { signal: req.signal }).catch(() => null),
  ]);
  return ok({ person, events, sessions });
});
