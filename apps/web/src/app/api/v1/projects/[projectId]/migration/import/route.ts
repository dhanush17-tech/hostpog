import { z } from "zod";
import { requireProject } from "@/server/authz";
import { body, ok, route } from "@/server/http";
import { startApiImport } from "@/server/migration";

type Ctx = { params: Promise<{ projectId: string }> };

const Input = z.object({ from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }) });

/** Start a bounded history import through PostHog's query API. */
export const POST = route<Ctx>(async (req, { params }) => {
  const { projectId } = await params;
  const a = await requireProject(projectId, "admin", req);
  const b = await body(req, Input);
  return ok({ job: await startApiImport(a, req, b) }, { status: 202 });
});
