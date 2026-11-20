import { credentials, getDb, ingestionKeys, nativePersons, projects, sources, type PostHogSourceConfig } from "@hostpog/db";
import { getClickHouse } from "@hostpog/native";
import { fetchMetadata, PostHogClient, probeScopes, revokeToken } from "@hostpog/posthog";
import { randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/server/audit";
import { requireProject } from "@/server/authz";
import { body, HttpError, ok, route } from "@/server/http";
import { decryptCredential, invalidateSourceCache, markSourceResult, providerFor, storeSecret } from "@/server/sources";

type Ctx = { params: Promise<{ projectId: string; sourceId: string }> };

async function load(projectId: string, sourceId: string) {
  const [s] = await getDb().select().from(sources).where(and(eq(sources.id, sourceId), eq(sources.projectId, projectId))).limit(1);
  if (!s) throw new HttpError(404, "Source not found");
  return s;
}

const Action = z.discriminatedUnion("action", [
  z.object({ action: z.literal("health") }),
  z.object({ action: z.literal("make_primary") }),
  z.object({ action: z.literal("rotate_key"), apiKey: z.string().min(10).max(200) }),
  z.object({ action: z.literal("rotate_ingestion_key") }),
  z.object({ action: z.literal("set_allowed_origins"), origins: z.array(z.string().url().max(200)).max(20) }),
  z.object({ action: z.literal("rename"), label: z.string().min(1).max(80) }),
]);

export const POST = route<Ctx>(async (req, { params }) => {
  const { projectId, sourceId } = await params;
  const b = await body(req, Action);
  const a = await requireProject(projectId, b.action === "health" ? "viewer" : "admin", req);
  const s = await load(projectId, sourceId);
  const db = getDb();

  switch (b.action) {
    case "health": {
      const p = await providerFor(a, s);
      const h = await p.health();
      await markSourceResult(s.id, h.ok ? null : h.message);
      return ok({ health: h, capabilities: await p.capabilities() });
    }
    case "make_primary":
      await db.update(projects).set({ primarySourceId: s.id }).where(eq(projects.id, projectId));
      await audit({ workspaceId: a.workspace.id, projectId, actorUserId: a.user.id, action: "source.make_primary", target: s.id, req });
      return ok({ primarySourceId: s.id });
    case "rename":
      await db.update(sources).set({ label: b.label }).where(eq(sources.id, s.id));
      return ok({ label: b.label });
    case "rotate_key": {
      if (s.kind !== "posthog" || !s.credentialId) throw new HttpError(400, "Only PostHog API-key sources can rotate keys");
      const cfg = s.config as unknown as PostHogSourceConfig;
      const client = new PostHogClient({ host: cfg.host, auth: { type: "api_key", key: b.apiKey }, credentialKey: `rotate:${s.id}` });
      const scopes = await probeScopes(client, cfg.externalProjectId);
      if (!scopes.find((x) => x.scope === "query:read")?.ok) throw new HttpError(400, "The new key cannot run queries on this PostHog project (query:read).");
      const enc = storeSecret(a.workspace.id, "posthog_api_key", b.apiKey);
      await db
        .update(credentials)
        .set({ ciphertext: enc.ciphertext, keyVersion: enc.keyVersion, hint: `${b.apiKey.slice(0, 4)}…${b.apiKey.slice(-3)}`, rotatedAt: new Date(), kind: "posthog_api_key" })
        .where(and(eq(credentials.id, s.credentialId), eq(credentials.workspaceId, a.workspace.id)));
      await db.update(sources).set({ config: { ...cfg, scopes: scopes.filter((x) => x.ok).map((x) => x.scope), authMethod: "api_key" }, status: "active", lastError: null }).where(eq(sources.id, s.id));
      invalidateSourceCache(a.workspace.id, s.id);
      await audit({ workspaceId: a.workspace.id, projectId, actorUserId: a.user.id, action: "credential.rotate", target: s.id, req });
      return ok({ rotated: true, scopes });
    }
    case "rotate_ingestion_key": {
      if (s.kind !== "native") throw new HttpError(400, "Only native sources have ingestion keys");
      await db.update(ingestionKeys).set({ revokedAt: new Date() }).where(and(eq(ingestionKeys.sourceId, s.id), isNull(ingestionKeys.revokedAt)));
      const publicKey = `hp_pk_${randomBytes(18).toString("base64url")}`;
      await db.insert(ingestionKeys).values({ projectId, sourceId: s.id, publicKey });
      await audit({ workspaceId: a.workspace.id, projectId, actorUserId: a.user.id, action: "ingestion_key.rotate", target: s.id, req });
      return ok({ publicKey });
    }
    case "set_allowed_origins": {
      await db.update(ingestionKeys).set({ allowedOrigins: b.origins.map((o) => new URL(o).origin) }).where(and(eq(ingestionKeys.sourceId, s.id), isNull(ingestionKeys.revokedAt)));
      return ok({ origins: b.origins });
    }
  }
});

/**
 * Two distinct destructive actions:
 *  ?mode=disconnect   stop using the source, revoke/delete its credential, keep any stored data
 *  ?mode=delete_data  delete events/persons HostPog stored for a native/demo/imported source
 * Disconnecting PostHog never changes anything in the customer's PostHog account.
 */
export const DELETE = route<Ctx>(async (req, { params }) => {
  const { projectId, sourceId } = await params;
  const a = await requireProject(projectId, "admin", req);
  const s = await load(projectId, sourceId);
  const mode = new URL(req.url).searchParams.get("mode") ?? "disconnect";
  const db = getDb();

  if (mode === "disconnect") {
    let revoked: boolean | null = null;
    if (s.credentialId) {
      try {
        const cred = await decryptCredential(a.workspace.id, s.credentialId);
        if (cred.kind === "posthog_oauth") {
          const bundle = JSON.parse(cred.secret) as { accessToken: string; refreshToken: string | null; clientId: string };
          const m = await fetchMetadata((s.config as unknown as PostHogSourceConfig).host);
          revoked = await revokeToken(m, { token: bundle.refreshToken ?? bundle.accessToken, clientId: bundle.clientId });
        }
      } catch {
        revoked = false;
      }
      await db.delete(credentials).where(and(eq(credentials.id, s.credentialId), eq(credentials.workspaceId, a.workspace.id)));
    }
    await db.update(ingestionKeys).set({ revokedAt: new Date() }).where(and(eq(ingestionKeys.sourceId, s.id), isNull(ingestionKeys.revokedAt)));
    await db.update(sources).set({ status: "disconnected", disconnectedAt: new Date(), credentialId: null }).where(eq(sources.id, s.id));
    if (a.project.primarySourceId === s.id) await db.update(projects).set({ primarySourceId: null }).where(eq(projects.id, projectId));
    invalidateSourceCache(a.workspace.id, s.id);
    await audit({ workspaceId: a.workspace.id, projectId, actorUserId: a.user.id, action: "source.disconnect", target: s.id, meta: { kind: s.kind, oauthRevoked: revoked }, req });
    return ok({ disconnected: true, credentialDeleted: Boolean(s.credentialId), oauthRevoked: revoked });
  }

  if (mode === "delete_data") {
    if (s.kind === "posthog") throw new HttpError(400, "HostPog stores no PostHog event data in connect mode; nothing to delete. Disconnect instead.");
    const ch = getClickHouse();
    for (const table of ["events", "person_distinct_ids", "person_props"]) {
      await ch.command({ query: `ALTER TABLE ${table} DELETE WHERE project_id = {p:String}`, query_params: { p: s.id }, clickhouse_settings: { mutations_sync: "1" } });
    }
    await db.delete(nativePersons).where(eq(nativePersons.partitionId, s.id));
    await audit({ workspaceId: a.workspace.id, projectId, actorUserId: a.user.id, action: "source.delete_data", target: s.id, meta: { kind: s.kind }, req });
    return ok({ deleted: true, note: "Events and persons removed from the event store and Postgres. Backups follow your backup retention." });
  }

  throw new HttpError(400, "mode must be disconnect or delete_data");
});
