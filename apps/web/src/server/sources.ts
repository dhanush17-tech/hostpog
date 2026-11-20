import "server-only";
import type { AnalyticsProvider } from "@hostpog/analytics";
import { credentialAad, credentials, decryptSecret, encryptSecret, getDb, sources, type PostHogSourceConfig } from "@hostpog/db";
import { getClickHouse, NativeProvider } from "@hostpog/native";
import { fetchMetadata, PostHogClient, PostHogProvider, refreshTokens, sharedCache } from "@hostpog/posthog";
import { and, eq, ne } from "drizzle-orm";
import type { ProjectAccess } from "./authz";
import { HttpError } from "./http";

export type SourceRow = typeof sources.$inferSelect;

export async function projectSources(projectId: string, includeDisconnected = false) {
  const db = getDb();
  return db
    .select()
    .from(sources)
    .where(includeDisconnected ? eq(sources.projectId, projectId) : and(eq(sources.projectId, projectId), ne(sources.status, "disconnected")))
    .orderBy(sources.createdAt);
}

/** Resolve exactly one source for a query. Sources are never merged or summed. */
export async function resolveSource(access: ProjectAccess, sourceId?: string | null): Promise<SourceRow> {
  const list = await projectSources(access.project.id);
  const s = sourceId
    ? list.find((x) => x.id === sourceId)
    : (list.find((x) => x.id === access.project.primarySourceId) ?? list.find((x) => x.kind !== "demo") ?? list[0]);
  if (!s) throw new HttpError(404, "No data source connected to this project", "no_source");
  return s;
}

export function storeSecret(workspaceId: string, kind: "posthog_api_key" | "posthog_oauth" | "ai_api_key", secret: string) {
  return encryptSecret(secret, credentialAad(workspaceId, kind));
}

async function loadCredential(workspaceId: string, id: string) {
  const db = getDb();
  const [c] = await db.select().from(credentials).where(and(eq(credentials.id, id), eq(credentials.workspaceId, workspaceId))).limit(1);
  if (!c) throw new HttpError(424, "The credential for this source was removed. Reconnect it.", "credential_missing");
  return c;
}

export async function decryptCredential(workspaceId: string, id: string): Promise<{ kind: string; secret: string; row: typeof credentials.$inferSelect }> {
  const c = await loadCredential(workspaceId, id);
  return { kind: c.kind, secret: decryptSecret(c.ciphertext, credentialAad(workspaceId, c.kind)), row: c };
}

interface OAuthBundle {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: string | null;
  clientId: string;
}

export async function providerFor(access: ProjectAccess, s: SourceRow): Promise<AnalyticsProvider> {
  if (s.projectId !== access.project.id) throw new HttpError(404, "Source not found", "not_found");
  if (s.status === "disconnected") throw new HttpError(409, "This source is disconnected", "disconnected");

  if (s.kind === "posthog") {
    const cfg = s.config as unknown as PostHogSourceConfig;
    if (!s.credentialId) throw new HttpError(424, "This PostHog source has no credential. Reconnect it.", "credential_missing");
    const cred = await decryptCredential(access.workspace.id, s.credentialId);
    const credentialKey = `${cred.row.id}:${cred.row.rotatedAt?.getTime() ?? cred.row.createdAt.getTime()}`;
    let client: PostHogClient;
    if (cred.kind === "posthog_oauth") {
      const bundle = JSON.parse(cred.secret) as OAuthBundle;
      client = new PostHogClient({
        host: cfg.host,
        credentialKey,
        auth: {
          type: "oauth",
          accessToken: bundle.accessToken,
          refresh: async () => {
            if (!bundle.refreshToken) throw new HttpError(424, "PostHog session expired. Reconnect PostHog.", "reauth");
            const m = await fetchMetadata(cfg.host);
            const t = await refreshTokens(m, { refreshToken: bundle.refreshToken, clientId: bundle.clientId });
            const next: OAuthBundle = { ...bundle, accessToken: t.accessToken, refreshToken: t.refreshToken ?? bundle.refreshToken, expiresAt: t.expiresAt };
            const enc = storeSecret(access.workspace.id, "posthog_oauth", JSON.stringify(next));
            await getDb()
              .update(credentials)
              .set({ ciphertext: enc.ciphertext, keyVersion: enc.keyVersion, expiresAt: t.expiresAt ? new Date(t.expiresAt) : null })
              .where(eq(credentials.id, cred.row.id));
            return t.accessToken;
          },
        },
        onRequest: (i) => recordProviderCall(s.id, i.status),
      });
    } else {
      client = new PostHogClient({ host: cfg.host, credentialKey, auth: { type: "api_key", key: cred.secret }, onRequest: (i) => recordProviderCall(s.id, i.status) });
    }
    return new PostHogProvider({
      client,
      tenantKey: access.workspace.id,
      sourceId: s.id,
      label: s.label,
      region: cfg.region,
      externalProjectId: cfg.externalProjectId,
      timezone: cfg.timezone || access.project.timezone,
      verifiedScopes: cfg.scopes,
    });
  }

  return new NativeProvider({
    db: getDb(),
    ch: getClickHouse(),
    partitionId: s.id,
    sourceId: s.id,
    label: s.label,
    timezone: access.project.timezone,
    kind: s.kind,
  });
}

export function invalidateSourceCache(workspaceId: string, sourceId: string) {
  sharedCache.invalidate(`${workspaceId}:${sourceId}:`);
}

/* lightweight in-process provider metrics (exposed in Settings → Data & usage) */
const providerStats = new Map<string, { ok: number; errors: number; rateLimited: number; last: string | null }>();
function recordProviderCall(sourceId: string, status: number | "network") {
  const s = providerStats.get(sourceId) ?? { ok: 0, errors: 0, rateLimited: 0, last: null };
  if (status === 429) s.rateLimited++;
  else if (status === "network" || status >= 400) s.errors++;
  else s.ok++;
  s.last = new Date().toISOString();
  providerStats.set(sourceId, s);
}
export function sourceStats(sourceId: string) {
  return providerStats.get(sourceId) ?? { ok: 0, errors: 0, rateLimited: 0, last: null };
}

export async function markSourceResult(sourceId: string, error: string | null) {
  await getDb()
    .update(sources)
    .set(error ? { lastError: error.slice(0, 500), status: "error" } : { lastSuccessAt: new Date(), lastError: null, status: "active" })
    .where(and(eq(sources.id, sourceId), ne(sources.status, "disconnected")));
}
