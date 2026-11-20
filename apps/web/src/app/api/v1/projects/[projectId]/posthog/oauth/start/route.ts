import { encryptSecret, getDb, oauthStates } from "@hostpog/db";
import { buildAuthorizeUrl, clientMetadataDocument, fetchMetadata, oauthAvailability, pkcePair, randomState } from "@hostpog/posthog";
import { requireProject } from "@/server/authz";
import { body, HttpError, ok, route } from "@/server/http";
import { hostFor, RegionInput } from "@/server/posthog-connect";

type Ctx = { params: Promise<{ projectId: string }> };

export const GET = route<Ctx>(async (_req, { params }) => {
  const { projectId } = await params;
  await requireProject(projectId, "admin");
  return ok(oauthAvailability(process.env.HOSTPOG_PUBLIC_URL));
});

/** Starts authorization code + PKCE. Only available when a real client can be registered (public HTTPS). */
export const POST = route<Ctx>(async (req, { params }) => {
  const { projectId } = await params;
  const a = await requireProject(projectId, "admin", req);
  const avail = oauthAvailability(process.env.HOSTPOG_PUBLIC_URL);
  if (!avail.available) throw new HttpError(409, avail.reason ?? "OAuth unavailable", "oauth_unavailable");
  const b = await body(req, RegionInput);
  const host = hostFor(b.region, b.host);
  const meta = await fetchMetadata(host);
  const doc = clientMetadataDocument(process.env.HOSTPOG_PUBLIC_URL!);
  const { verifier, challenge } = pkcePair();
  const state = randomState();
  const redirectUri = doc.redirect_uris[0]!;
  await getDb()
    .insert(oauthStates)
    .values({
      state,
      workspaceId: a.workspace.id,
      projectId,
      userId: a.user.id,
      region: b.region,
      host,
      redirectUri,
      codeVerifierCiphertext: encryptSecret(verifier, `hostpog:oauth-state:${state}`).ciphertext,
      expiresAt: new Date(Date.now() + 10 * 60_000),
    });
  return ok({ authorizeUrl: buildAuthorizeUrl(meta, { clientId: doc.client_id, redirectUri, state, challenge }) });
});
