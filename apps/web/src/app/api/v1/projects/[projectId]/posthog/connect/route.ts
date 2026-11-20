import { z } from "zod";
import { requireProject } from "@/server/authz";
import { body, ok, route } from "@/server/http";
import { apiKeyClient, finishConnect, hostFor, RegionInput } from "@/server/posthog-connect";

type Ctx = { params: Promise<{ projectId: string }> };

const Input = RegionInput.extend({
  apiKey: z.string().min(10).max(200),
  externalProjectId: z.string().regex(/^\d{1,12}$/, "PostHog project ids are numeric"),
});

export const POST = route<Ctx>(async (req, { params }) => {
  const { projectId } = await params;
  const access = await requireProject(projectId, "admin", req);
  const b = await body(req, Input);
  const host = hostFor(b.region, b.host);
  const key = b.apiKey.trim();
  apiKeyClient(host, key); // format validation
  const res = await finishConnect({
    access,
    req,
    region: b.region,
    host,
    auth: { type: "api_key", key },
    secretToStore: { kind: "posthog_api_key", secret: key, hint: `phx_…${key.slice(-3)}` },
    externalProjectId: b.externalProjectId,
  });
  return ok(res, { status: 201 });
});
