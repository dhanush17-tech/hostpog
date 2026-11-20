import "server-only";
import { credentials, getDb, projects, sources, type PostHogSourceConfig } from "@hostpog/db";
import { discoverProjects, PostHogClient, probeScopes, regionLabel, resolvePostHogHost, type PostHogAuth, type PostHogRegion } from "@hostpog/posthog";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { audit } from "./audit";
import type { ProjectAccess } from "./authz";
import { HttpError } from "./http";
import { providerFor, storeSecret } from "./sources";

export const RegionInput = z.object({
  region: z.enum(["us", "eu", "self_hosted"]),
  host: z.string().url().max(300).optional(),
});

export function hostFor(region: PostHogRegion, host?: string) {
  try {
    return resolvePostHogHost(region, host);
  } catch (e) {
    throw new HttpError(400, (e as Error).message, "host_not_allowed");
  }
}

export function apiKeyClient(host: string, apiKey: string) {
  if (!/^phx_[A-Za-z0-9_-]{10,}$/.test(apiKey)) throw new HttpError(400, "That does not look like a PostHog personal API key (phx_…). Never paste your PostHog password.", "bad_key");
  return new PostHogClient({ host, auth: { type: "api_key", key: apiKey }, credentialKey: `connect:${apiKey.slice(-6)}` });
}

export async function discover(client: PostHogClient) {
  return discoverProjects(client, AbortSignal.timeout(20_000));
}

/** Validate, persist and run the first bounded query. Returns timings so first-value latency is measured, not promised. */
export async function finishConnect(opts: {
  access: ProjectAccess;
  req: Request;
  region: PostHogRegion;
  host: string;
  auth: PostHogAuth;
  secretToStore: { kind: "posthog_api_key" | "posthog_oauth"; secret: string; hint: string; expiresAt?: string | null };
  externalProjectId: string;
  existingCredentialId?: string;
}) {
  const started = Date.now();
  const { access } = opts;
  const client = new PostHogClient({ host: opts.host, auth: opts.auth, credentialKey: `connect:${opts.externalProjectId}:${Date.now()}` });
  const disc = await discoverProjects(client, AbortSignal.timeout(20_000)).catch(() => null);
  const project = disc?.projects.find((p) => p.id === opts.externalProjectId);
  if (disc && disc.projects.length && !project) throw new HttpError(403, "This credential cannot access that PostHog project.", "project_forbidden");
  const scopes = await probeScopes(client, opts.externalProjectId, AbortSignal.timeout(30_000));
  if (!scopes.find((s) => s.scope === "query:read")?.ok) {
    throw new HttpError(400, "The credential cannot run queries on this project. Grant the query:read scope (read-only) and try again.", "missing_scope", { scopes });
  }

  const db = getDb();
  // Idempotent: a retry after a dropped response must not create a second source for the same PostHog project.
  const existing = (await db.select().from(sources).where(and(eq(sources.projectId, access.project.id), eq(sources.kind, "posthog")))).find((s) => {
    const c = s.config as Partial<PostHogSourceConfig>;
    return s.status !== "disconnected" && c.externalProjectId === opts.externalProjectId && c.host === opts.host;
  });
  if (existing) {
    return {
      source: { id: existing.id, label: existing.label, region: regionLabel(opts.region), config: existing.config as unknown as PostHogSourceConfig },
      scopes,
      firstResult: null,
      firstError: null,
      alreadyConnected: true,
      connectedAt: existing.createdAt.toISOString(),
      timeToFirstResultMs: Date.now() - started,
    };
  }
  let credentialId = opts.existingCredentialId;
  if (!credentialId) {
    const enc = storeSecret(access.workspace.id, opts.secretToStore.kind, opts.secretToStore.secret);
    const [c] = await db
      .insert(credentials)
      .values({
        workspaceId: access.workspace.id,
        kind: opts.secretToStore.kind,
        ciphertext: enc.ciphertext,
        keyVersion: enc.keyVersion,
        hint: opts.secretToStore.hint,
        expiresAt: opts.secretToStore.expiresAt ? new Date(opts.secretToStore.expiresAt) : null,
      })
      .returning({ id: credentials.id });
    credentialId = c!.id;
  }
  const config: PostHogSourceConfig = {
    region: opts.region,
    host: opts.host,
    organizationId: project?.organizationId ?? null,
    externalProjectId: opts.externalProjectId,
    externalProjectName: project?.name ?? `Project ${opts.externalProjectId}`,
    timezone: project?.timezone ?? access.project.timezone,
    authMethod: opts.auth.type,
    scopes: scopes.filter((s) => s.ok).map((s) => s.scope),
  };
  const [src] = await db
    .insert(sources)
    .values({
      projectId: access.project.id,
      kind: "posthog",
      label: `PostHog · ${config.externalProjectName}`,
      status: "active",
      config: config as unknown as Record<string, unknown>,
      credentialId,
    })
    .returning();
  if (!access.project.primarySourceId) {
    await db.update(projects).set({ primarySourceId: src!.id, timezone: config.timezone }).where(eq(projects.id, access.project.id));
  }
  await audit({
    workspaceId: access.workspace.id,
    projectId: access.project.id,
    actorUserId: access.user.id,
    action: "source.connect_posthog",
    target: src!.id,
    meta: { region: opts.region, authMethod: opts.auth.type, externalProjectId: opts.externalProjectId, scopes: config.scopes },
    req: opts.req,
  });

  // one bounded query to populate the first dashboard
  let first: unknown = null;
  let firstError: string | null = null;
  try {
    const p = await providerFor({ ...access, project: { ...access.project, timezone: config.timezone } }, src!);
    first = await p.query({ kind: "summary", dateRange: { from: "-7d", to: "now" } });
    await db.update(sources).set({ lastSuccessAt: new Date() }).where(eq(sources.id, src!.id));
  } catch (e) {
    firstError = (e as Error).message;
  }
  return {
    source: { id: src!.id, label: src!.label, region: regionLabel(opts.region), config },
    scopes,
    firstResult: first,
    firstError,
    alreadyConnected: false,
    connectedAt: src!.createdAt.toISOString(),
    timeToFirstResultMs: Date.now() - started,
  };
}
