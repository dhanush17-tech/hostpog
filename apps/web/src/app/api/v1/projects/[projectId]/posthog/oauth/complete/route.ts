import { discoverProjects, PostHogClient, resolvePostHogHost } from "@hostpog/posthog";
import { z } from "zod";
import { requireProject } from "@/server/authz";
import { body, HttpError, ok, route } from "@/server/http";
import { finishConnect } from "@/server/posthog-connect";
import { decryptCredential } from "@/server/sources";

type Ctx = { params: Promise<{ projectId: string }> };

const Input = z.object({
  credentialId: z.string().uuid(),
  region: z.enum(["us", "eu"]),
  externalProjectId: z.string().regex(/^\d{1,12}$/).optional(),
});

/** Without externalProjectId: list projects the token can see. With it: finish the connection. */
export const POST = route<Ctx>(async (req, { params }) => {
  const { projectId } = await params;
  const access = await requireProject(projectId, "admin", req);
  const b = await body(req, Input);
  const cred = await decryptCredential(access.workspace.id, b.credentialId);
  if (cred.kind !== "posthog_oauth") throw new HttpError(400, "Not an OAuth credential");
  const bundle = JSON.parse(cred.secret) as { accessToken: string };
  const host = resolvePostHogHost(b.region);
  if (!b.externalProjectId) {
    const client = new PostHogClient({ host, auth: { type: "oauth", accessToken: bundle.accessToken }, credentialKey: cred.row.id });
    return ok(await discoverProjects(client));
  }
  const res = await finishConnect({
    access,
    req,
    region: b.region,
    host,
    auth: { type: "oauth", accessToken: bundle.accessToken },
    secretToStore: { kind: "posthog_oauth", secret: cred.secret, hint: "OAuth" },
    externalProjectId: b.externalProjectId,
    existingCredentialId: cred.row.id,
  });
  return ok(res, { status: 201 });
});
