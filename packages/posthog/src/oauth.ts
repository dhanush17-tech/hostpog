/**
 * PostHog OAuth 2.0 (authorization code + PKCE S256), per
 * https://posthog.com/docs/api/oauth. Clients are registered with a Client ID
 * Metadata Document (CIMD): the client_id IS an HTTPS URL that serves the
 * document below, so OAuth only works when HostPog is publicly reachable over
 * HTTPS. Endpoints are always read from the authorization server metadata.
 */
import { createHash, randomBytes } from "node:crypto";
import { ProviderError } from "@hostpog/analytics";
import { OPTIONAL_SCOPES, REQUIRED_SCOPES } from "./discovery";

export interface AuthServerMetadata {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  revocation_endpoint?: string;
  code_challenge_methods_supported?: string[];
}

export function pkcePair() {
  const verifier = randomBytes(48).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function randomState() {
  return randomBytes(24).toString("base64url");
}

export async function fetchMetadata(host: string, f: typeof fetch = fetch): Promise<AuthServerMetadata> {
  const res = await f(new URL("/.well-known/oauth-authorization-server", host), { redirect: "error" });
  if (!res.ok) throw new ProviderError("upstream", `OAuth metadata unavailable (${res.status})`);
  const m = (await res.json()) as AuthServerMetadata;
  const origin = new URL(host).origin;
  for (const k of ["authorization_endpoint", "token_endpoint"] as const) {
    if (!m[k] || new URL(m[k]).origin !== origin) throw new ProviderError("upstream", `OAuth metadata ${k} is not on ${origin}`);
  }
  if (m.code_challenge_methods_supported && !m.code_challenge_methods_supported.includes("S256")) {
    throw new ProviderError("upstream", "PostHog authorization server does not advertise PKCE S256");
  }
  return m;
}

export function clientMetadataDocument(publicUrl: string) {
  const base = publicUrl.replace(/\/$/, "");
  return {
    client_id: `${base}/oauth/posthog-client.json`,
    client_name: "HostPog",
    client_uri: base,
    redirect_uris: [`${base}/api/v1/posthog/oauth/callback`],
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
    "com.posthog": { scopes: [...REQUIRED_SCOPES], optional_scopes: [...OPTIONAL_SCOPES] },
  };
}

/** OAuth needs a public HTTPS origin PostHog can fetch the CIMD from. */
export function oauthAvailability(publicUrl: string | undefined): { available: boolean; reason: string | null } {
  if (process.env.HOSTPOG_POSTHOG_OAUTH_ENABLED !== "true") {
    return { available: false, reason: "OAuth is disabled on this instance (set HOSTPOG_POSTHOG_OAUTH_ENABLED=true)." };
  }
  if (!publicUrl) return { available: false, reason: "HOSTPOG_PUBLIC_URL is not set." };
  const u = new URL(publicUrl);
  if (u.protocol !== "https:" || /^(localhost|127\.|10\.|192\.168\.)/.test(u.hostname)) {
    return {
      available: false,
      reason: "PostHog must be able to fetch HostPog's client metadata over public HTTPS. Use a personal API key on local installs.",
    };
  }
  return { available: true, reason: null };
}

export function buildAuthorizeUrl(m: AuthServerMetadata, p: { clientId: string; redirectUri: string; state: string; challenge: string; scopes?: string[] }) {
  const u = new URL(m.authorization_endpoint);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", p.clientId);
  u.searchParams.set("redirect_uri", p.redirectUri);
  u.searchParams.set("scope", (p.scopes ?? [...REQUIRED_SCOPES, ...OPTIONAL_SCOPES]).join(" "));
  u.searchParams.set("state", p.state);
  u.searchParams.set("code_challenge", p.challenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  scope: string | null;
}

async function tokenRequest(m: AuthServerMetadata, form: Record<string, string>, f: typeof fetch): Promise<TokenSet> {
  const res = await f(m.token_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(form),
    redirect: "error",
  });
  const j = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    refresh_token?: string;
    expires_in?: number;
    scope?: string;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !j.access_token) {
    throw new ProviderError(res.status === 400 || res.status === 401 ? "unauthorized" : "upstream", `token endpoint: ${j.error_description ?? j.error ?? res.status}`);
  }
  return {
    accessToken: j.access_token,
    refreshToken: j.refresh_token ?? null,
    expiresAt: j.expires_in ? new Date(Date.now() + j.expires_in * 1000).toISOString() : null,
    scope: j.scope ?? null,
  };
}

export function exchangeCode(
  m: AuthServerMetadata,
  p: { code: string; clientId: string; redirectUri: string; verifier: string },
  f: typeof fetch = fetch,
) {
  return tokenRequest(m, { grant_type: "authorization_code", code: p.code, redirect_uri: p.redirectUri, client_id: p.clientId, code_verifier: p.verifier }, f);
}

export function refreshTokens(m: AuthServerMetadata, p: { refreshToken: string; clientId: string }, f: typeof fetch = fetch) {
  return tokenRequest(m, { grant_type: "refresh_token", refresh_token: p.refreshToken, client_id: p.clientId }, f);
}

export async function revokeToken(m: AuthServerMetadata, p: { token: string; clientId: string }, f: typeof fetch = fetch) {
  if (!m.revocation_endpoint) return false;
  const res = await f(m.revocation_endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token: p.token, client_id: p.clientId }),
    redirect: "error",
  });
  return res.ok;
}
