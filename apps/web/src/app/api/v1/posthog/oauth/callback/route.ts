import { credentials, decryptSecret, getDb, oauthStates } from "@hostpog/db";
import { clientMetadataDocument, exchangeCode, fetchMetadata } from "@hostpog/posthog";
import { and, eq, gt, isNull } from "drizzle-orm";
import { NextResponse } from "next/server";
import { requireUser } from "@/server/authz";
import { storeSecret } from "@/server/sources";

/**
 * OAuth redirect target. Validates state (single use, 10 min expiry, bound to
 * the signed-in user), exchanges the code with the PKCE verifier and stores the
 * token set encrypted. The user then picks a PostHog project.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const base = process.env.HOSTPOG_PUBLIC_URL ?? url.origin;
  const fail = (msg: string) => NextResponse.redirect(`${base}/app/onboarding/posthog?oauth_error=${encodeURIComponent(msg)}`);
  const user = await requireUser().catch(() => null);
  if (!user) return fail("Sign in to HostPog first");
  if (url.searchParams.get("error")) return fail(url.searchParams.get("error_description") ?? "Authorization was not granted");
  const state = url.searchParams.get("state");
  const code = url.searchParams.get("code");
  if (!state || !code) return fail("Missing state or code");

  const db = getDb();
  // atomically consume the state (replay prevention)
  const [st] = await db
    .update(oauthStates)
    .set({ usedAt: new Date() })
    .where(and(eq(oauthStates.state, state), isNull(oauthStates.usedAt), gt(oauthStates.expiresAt, new Date()), eq(oauthStates.userId, user.id)))
    .returning();
  if (!st) return fail("Authorization expired or was already used. Start again.");

  try {
    const verifier = decryptSecret(st.codeVerifierCiphertext, `hostpog:oauth-state:${state}`);
    const meta = await fetchMetadata(st.host);
    const doc = clientMetadataDocument(process.env.HOSTPOG_PUBLIC_URL!);
    const t = await exchangeCode(meta, { code, clientId: doc.client_id, redirectUri: st.redirectUri, verifier });
    const enc = storeSecret(st.workspaceId, "posthog_oauth", JSON.stringify({ ...t, clientId: doc.client_id }));
    const [c] = await db
      .insert(credentials)
      .values({ workspaceId: st.workspaceId, kind: "posthog_oauth", ciphertext: enc.ciphertext, keyVersion: enc.keyVersion, hint: "OAuth", expiresAt: t.expiresAt ? new Date(t.expiresAt) : null })
      .returning({ id: credentials.id });
    return NextResponse.redirect(`${base}/app/onboarding/posthog?project=${st.projectId}&oauth_credential=${c!.id}&region=${st.region}`);
  } catch (e) {
    return fail((e as Error).message);
  }
}
