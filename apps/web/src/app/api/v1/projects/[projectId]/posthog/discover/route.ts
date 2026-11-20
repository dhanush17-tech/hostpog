import { z } from "zod";
import { requireProject } from "@/server/authz";
import { body, ok, route } from "@/server/http";
import { apiKeyClient, discover, hostFor, RegionInput } from "@/server/posthog-connect";

type Ctx = { params: Promise<{ projectId: string }> };

const Input = RegionInput.extend({ apiKey: z.string().min(10).max(200) });

/** Read-only discovery. The key is used for this request only and is not stored. */
export const POST = route<Ctx>(async (req, { params }) => {
  const { projectId } = await params;
  await requireProject(projectId, "admin", req);
  const b = await body(req, Input);
  const client = apiKeyClient(hostFor(b.region, b.host), b.apiKey.trim());
  const d = await discover(client);
  return ok(d);
});
