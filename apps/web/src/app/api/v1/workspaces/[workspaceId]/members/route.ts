import { Role } from "@hostpog/contracts";
import { getDb, memberships, user } from "@hostpog/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/server/audit";
import { requireWorkspace } from "@/server/authz";
import { body, HttpError, ok, route } from "@/server/http";

type Ctx = { params: Promise<{ workspaceId: string }> };

export const GET = route<Ctx>(async (_req, { params }) => {
  const { workspaceId } = await params;
  await requireWorkspace(workspaceId);
  const rows = await getDb()
    .select({ userId: user.id, name: user.name, email: user.email, role: memberships.role, since: memberships.createdAt })
    .from(memberships)
    .innerJoin(user, eq(user.id, memberships.userId))
    .where(eq(memberships.workspaceId, workspaceId));
  return ok({ members: rows });
});

/** Add an existing HostPog user by email (email invitations need SMTP; see docs/self-host.md). */
export const POST = route<Ctx>(async (req, { params }) => {
  const { workspaceId } = await params;
  const a = await requireWorkspace(workspaceId, "admin", req);
  const b = await body(req, z.object({ email: z.string().email(), role: Role.exclude(["owner"]) }));
  const db = getDb();
  const [u] = await db.select().from(user).where(eq(user.email, b.email.toLowerCase())).limit(1);
  if (!u) throw new HttpError(404, "No HostPog account with that email. Ask them to sign up first.", "no_user");
  await db.insert(memberships).values({ workspaceId, userId: u.id, role: b.role }).onConflictDoNothing();
  await audit({ workspaceId, actorUserId: a.user.id, action: "member.add", target: u.id, meta: { role: b.role }, req });
  return ok({ added: true }, { status: 201 });
});

export const PATCH = route<Ctx>(async (req, { params }) => {
  const { workspaceId } = await params;
  const a = await requireWorkspace(workspaceId, "owner", req);
  const b = await body(req, z.object({ userId: z.string(), role: Role }));
  if (b.userId === a.user.id) throw new HttpError(400, "You cannot change your own role");
  await getDb().update(memberships).set({ role: b.role }).where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, b.userId)));
  await audit({ workspaceId, actorUserId: a.user.id, action: "member.role", target: b.userId, meta: { role: b.role }, req });
  return ok({ updated: true });
});

export const DELETE = route<Ctx>(async (req, { params }) => {
  const { workspaceId } = await params;
  const a = await requireWorkspace(workspaceId, "admin", req);
  const userId = new URL(req.url).searchParams.get("userId");
  if (!userId || userId === a.user.id) throw new HttpError(400, "Choose another member to remove");
  const [m] = await getDb().select().from(memberships).where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId))).limit(1);
  if (m?.role === "owner") throw new HttpError(403, "Owners cannot be removed");
  await getDb().delete(memberships).where(and(eq(memberships.workspaceId, workspaceId), eq(memberships.userId, userId)));
  await audit({ workspaceId, actorUserId: a.user.id, action: "member.remove", target: userId, req });
  return ok({ removed: true });
});
