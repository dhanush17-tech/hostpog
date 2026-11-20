import { z } from "zod";
import { requireProject } from "@/server/authz";
import { body, ok, route } from "@/server/http";
import { FlagInput, previewFlag } from "@/server/products";

type Ctx = { params: Promise<{ projectId: string }> };
const Input = z.object({ flag: FlagInput, distinctId: z.string().trim().min(1).max(400), properties: z.record(z.string(), z.unknown()).default({}) });

/** "What would this user get?" — evaluates an unsaved flag definition. */
export const POST = route<Ctx>(async (req, { params }) => {
  const { projectId } = await params;
  await requireProject(projectId, "viewer", req);
  const b = await body(req, Input);
  return ok({ result: previewFlag(b.flag, b.distinctId, b.properties) });
});
