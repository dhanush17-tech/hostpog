/**
 * Connect-time discovery: which organizations/projects can this credential see,
 * and which read scopes actually work. Every call is read-only.
 */
import { ProviderError } from "@hostpog/analytics";
import type { PostHogClient } from "./client";

export interface DiscoveredProject {
  id: string;
  name: string;
  organizationId: string | null;
  organizationName: string | null;
  timezone: string;
}

export interface DiscoveryResult {
  user: { email: string | null } | null;
  projects: DiscoveredProject[];
  /** true when the credential cannot list projects (e.g. no user:read/project:read); ask for a project ID */
  needsManualProject: boolean;
  warnings: string[];
}

interface MeResponse {
  email?: string;
  organization?: { id: string; name: string; teams?: { id: number; name: string; timezone?: string }[] } | null;
  organizations?: { id: string; name: string }[];
}

interface ProjectListItem {
  id: number;
  name: string;
  timezone?: string;
  organization?: string;
}

export async function discoverProjects(client: PostHogClient, signal?: AbortSignal): Promise<DiscoveryResult> {
  const warnings: string[] = [];
  let me: MeResponse | null = null;
  try {
    me = await client.request<MeResponse>("/api/users/@me/", { signal });
  } catch (e) {
    if (e instanceof ProviderError && e.code === "unauthorized") throw e;
    warnings.push(`Could not read the PostHog user (${(e as Error).message}).`);
  }
  const orgs = new Map<string, string>();
  for (const o of me?.organizations ?? []) orgs.set(o.id, o.name);
  if (me?.organization) orgs.set(me.organization.id, me.organization.name);

  const projects: DiscoveredProject[] = [];
  for (const [orgId, orgName] of orgs) {
    try {
      const list = await client.paginate<ProjectListItem>(`/api/organizations/${encodeURIComponent(orgId)}/projects/`, {
        query: { limit: 100 },
        maxPages: 3,
        signal,
      });
      for (const p of list) {
        projects.push({ id: String(p.id), name: p.name, organizationId: orgId, organizationName: orgName, timezone: p.timezone ?? "UTC" });
      }
    } catch (e) {
      if (e instanceof ProviderError && e.code === "unauthorized") throw e;
      warnings.push(`Could not list projects for organization ${orgName} (${(e as Error).message}).`);
      // fall back to teams embedded in /@me for the current organization
      if (me?.organization?.id === orgId) {
        for (const t of me.organization.teams ?? []) {
          projects.push({ id: String(t.id), name: t.name, organizationId: orgId, organizationName: orgName, timezone: t.timezone ?? "UTC" });
        }
      }
    }
  }
  const unique = [...new Map(projects.map((p) => [p.id, p])).values()];
  return { user: me ? { email: me.email ?? null } : null, projects: unique, needsManualProject: unique.length === 0, warnings };
}

export type ScopeProbe = "query:read" | "event_definition:read" | "session_recording:read" | "insight:read";

export interface ScopeCheck {
  scope: ScopeProbe;
  ok: boolean;
  detail: string;
}

/**
 * Probe the minimal read scopes HostPog uses. Each probe is one cheap read
 * (the query probe spends one call of the hourly query budget).
 */
export async function probeScopes(client: PostHogClient, projectId: string, signal?: AbortSignal): Promise<ScopeCheck[]> {
  const p = (s: string) => `/api/projects/${encodeURIComponent(projectId)}/${s}`;
  const probes: [ScopeProbe, () => Promise<unknown>][] = [
    [
      "query:read",
      () =>
        client.request(p("query/"), {
          method: "POST",
          category: "query",
          signal,
          body: { query: { kind: "HogQLQuery", query: "SELECT 1" }, name: "hostpog:scope-probe" },
        }),
    ],
    ["event_definition:read", () => client.request(p("event_definitions/"), { query: { limit: 1 }, signal })],
    ["session_recording:read", () => client.request(p("session_recordings/"), { query: { limit: 1 }, category: "analytics", signal })],
    ["insight:read", () => client.request(p("insights/"), { query: { limit: 1 }, category: "analytics", signal })],
  ];
  const out: ScopeCheck[] = [];
  for (const [scope, run] of probes) {
    try {
      await run();
      out.push({ scope, ok: true, detail: "ok" });
    } catch (e) {
      if (e instanceof ProviderError && e.code === "unauthorized") throw e;
      out.push({ scope, ok: false, detail: (e as Error).message });
    }
  }
  return out;
}

/** Minimum scopes to request (OAuth) / recommend (personal API keys). */
export const REQUIRED_SCOPES = ["user:read", "project:read", "query:read", "event_definition:read"] as const;
export const OPTIONAL_SCOPES = ["person:read", "insight:read", "session_recording:read"] as const;

/**
 * The public project token (phc_…) of a PostHog project, read from the documented
 * organization projects list (`api_token`). Used to route a migrating SDK's events
 * and to prove the token belongs to the connected project. Not a secret.
 */
export async function projectToken(client: PostHogClient, organizationId: string, projectId: string, signal?: AbortSignal): Promise<string | null> {
  const list = await client.paginate<{ id: number; api_token?: string }>(`/api/organizations/${encodeURIComponent(organizationId)}/projects/`, {
    query: { limit: 100 },
    maxPages: 5,
    signal,
  });
  return list.find((p) => String(p.id) === projectId)?.api_token ?? null;
}
