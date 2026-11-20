/**
 * Centralised authorization. Every project/workspace resource access in route
 * handlers, background runs and agent tools goes through these helpers.
 *
 * Role matrix:
 *  owner/admin  manage credentials, sources, AI providers, team, deletion
 *  member       query, create insights/dashboards/investigations
 *  viewer       read-only
 */
import "server-only";
import { ROLE_RANK, type Role } from "@hostpog/contracts";
import { getDb, memberships, projects, workspaces } from "@hostpog/db";
import { and, eq, isNull } from "drizzle-orm";
import { headers } from "next/headers";
import { auth } from "./auth";
import { HttpError } from "./http";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const s = await auth.api.getSession({ headers: await headers() });
  return s ? { id: s.user.id, email: s.user.email, name: s.user.name } : null;
}

export async function requireUser(): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) throw new HttpError(401, "Sign in required", "unauthenticated");
  return u;
}

/** CSRF defence for cookie-authenticated, state-changing JSON endpoints. */
export function assertSameOrigin(req: Request) {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers.get("origin");
  const expected = new URL(process.env.HOSTPOG_PUBLIC_URL ?? "http://localhost:3000").origin;
  const host = req.headers.get("host");
  const sameHost = origin && host && new URL(origin).host === host;
  if (!origin || (origin !== expected && !sameHost)) throw new HttpError(403, "Cross-origin request rejected", "csrf");
}

export interface ProjectAccess {
  user: SessionUser;
  role: Role;
  project: typeof projects.$inferSelect;
  workspace: typeof workspaces.$inferSelect;
}

export function hasRole(role: Role, min: Role) {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

export async function requireProject(projectId: string, min: Role = "viewer", req?: Request): Promise<ProjectAccess> {
  if (req) assertSameOrigin(req);
  const user = await requireUser();
  if (!/^[0-9a-f-]{36}$/i.test(projectId)) throw new HttpError(404, "Project not found", "not_found");
  const db = getDb();
  const rows = await db
    .select({ project: projects, workspace: workspaces, role: memberships.role })
    .from(projects)
    .innerJoin(workspaces, eq(workspaces.id, projects.workspaceId))
    .innerJoin(memberships, and(eq(memberships.workspaceId, projects.workspaceId), eq(memberships.userId, user.id)))
    .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
    .limit(1);
  const r = rows[0];
  // Not-a-member and not-found are indistinguishable to avoid leaking project ids.
  if (!r) throw new HttpError(404, "Project not found", "not_found");
  if (!hasRole(r.role, min)) throw new HttpError(403, `This action requires the ${min} role`, "forbidden");
  return { user, role: r.role, project: r.project, workspace: r.workspace };
}

export async function requireWorkspace(workspaceId: string, min: Role = "viewer", req?: Request) {
  if (req) assertSameOrigin(req);
  const user = await requireUser();
  if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) throw new HttpError(404, "Workspace not found", "not_found");
  const db = getDb();
  const rows = await db
    .select({ workspace: workspaces, role: memberships.role })
    .from(workspaces)
    .innerJoin(memberships, and(eq(memberships.workspaceId, workspaces.id), eq(memberships.userId, user.id)))
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  const r = rows[0];
  if (!r) throw new HttpError(404, "Workspace not found", "not_found");
  if (!hasRole(r.role, min)) throw new HttpError(403, `This action requires the ${min} role`, "forbidden");
  return { user, role: r.role, workspace: r.workspace };
}

export async function listAccessible(userId: string) {
  const db = getDb();
  const rows = await db
    .select({ workspace: workspaces, role: memberships.role, project: projects })
    .from(memberships)
    .innerJoin(workspaces, eq(workspaces.id, memberships.workspaceId))
    .leftJoin(projects, and(eq(projects.workspaceId, workspaces.id), isNull(projects.deletedAt)))
    .where(eq(memberships.userId, userId));
  const out = new Map<string, { id: string; name: string; role: Role; projects: { id: string; name: string; timezone: string }[] }>();
  for (const r of rows) {
    const w = out.get(r.workspace.id) ?? { id: r.workspace.id, name: r.workspace.name, role: r.role, projects: [] };
    if (r.project) w.projects.push({ id: r.project.id, name: r.project.name, timezone: r.project.timezone });
    out.set(r.workspace.id, w);
  }
  return [...out.values()];
}
