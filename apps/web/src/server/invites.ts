import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { getDb, invites, memberships, projects, user, workspaces } from "@hostpog/db";
import { and, asc, desc, eq, gt, isNull, sql } from "drizzle-orm";
import { audit } from "./audit";
import { HttpError } from "./http";

const DAY = 86_400_000;
export const INVITE_DAYS = 7;

const hash = (token: string) => createHash("sha256").update(token).digest("hex");
const publicUrl = () => (process.env.HOSTPOG_PUBLIC_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
export const inviteUrl = (token: string) => `${publicUrl()}/invite/${token}`;

/**
 * Invite someone to a workspace. An email that already has an account is added right away (nothing to accept).
 * Otherwise returns a link: bound to that email and single-use, or, with no email, an open link for the whole team.
 */
export async function createInvite(opts: { workspaceId: string; actorId: string; email?: string | null; role: "admin" | "member" | "viewer"; req: Request }) {
  const db = getDb();
  const email = opts.email?.trim().toLowerCase() || null;
  if (email) {
    const [u] = await db.select({ id: user.id }).from(user).where(eq(user.email, email)).limit(1);
    if (u) {
      await db.insert(memberships).values({ workspaceId: opts.workspaceId, userId: u.id, role: opts.role }).onConflictDoNothing();
      await audit({ workspaceId: opts.workspaceId, actorUserId: opts.actorId, action: "member.add", target: u.id, meta: { role: opts.role }, req: opts.req });
      return { added: true as const, email };
    }
  }
  const token = randomBytes(24).toString("base64url");
  const [row] = await db
    .insert(invites)
    .values({ workspaceId: opts.workspaceId, tokenHash: hash(token), email, role: opts.role, createdBy: opts.actorId, expiresAt: new Date(Date.now() + INVITE_DAYS * DAY) })
    .returning();
  await audit({ workspaceId: opts.workspaceId, actorUserId: opts.actorId, action: "invite.create", target: row!.id, meta: { role: opts.role, email: Boolean(email) }, req: opts.req });
  return { added: false as const, invite: publicInvite(row!), url: inviteUrl(token) };
}

export function publicInvite(r: typeof invites.$inferSelect) {
  return { id: r.id, email: r.email, role: r.role, createdAt: r.createdAt, expiresAt: r.expiresAt, uses: r.uses, open: !r.email };
}

/** Invites that can still be used. */
export async function listInvites(workspaceId: string) {
  const rows = await getDb()
    .select()
    .from(invites)
    .where(and(eq(invites.workspaceId, workspaceId), isNull(invites.revokedAt), isNull(invites.acceptedAt), gt(invites.expiresAt, new Date())))
    .orderBy(desc(invites.createdAt));
  return rows.map(publicInvite);
}

export async function revokeInvite(workspaceId: string, id: string, actorId: string, req: Request) {
  await getDb().update(invites).set({ revokedAt: new Date() }).where(and(eq(invites.id, id), eq(invites.workspaceId, workspaceId)));
  await audit({ workspaceId, actorUserId: actorId, action: "invite.revoke", target: id, req });
}

export type InviteState =
  | { ok: true; workspaceName: string; inviter: string | null; role: string; email: string | null }
  | { ok: false; reason: "not_found" | "expired" | "used" };

/** What the invite page shows, before anyone accepts. */
export async function lookupInvite(token: string): Promise<InviteState> {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return { ok: false, reason: "not_found" };
  const [r] = await getDb()
    .select({ i: invites, workspaceName: workspaces.name, inviter: user.name })
    .from(invites)
    .innerJoin(workspaces, eq(workspaces.id, invites.workspaceId))
    .leftJoin(user, eq(user.id, invites.createdBy))
    .where(eq(invites.tokenHash, hash(token)))
    .limit(1);
  if (!r || r.i.revokedAt) return { ok: false, reason: "not_found" };
  if (r.i.acceptedAt) return { ok: false, reason: "used" };
  if (r.i.expiresAt < new Date()) return { ok: false, reason: "expired" };
  return { ok: true, workspaceName: r.workspaceName, inviter: r.inviter, role: r.i.role, email: r.i.email };
}

/** Join the workspace. Returns the project to open. Existing members keep their current role. */
export async function acceptInvite(token: string, u: { id: string; email: string }, req: Request | null) {
  const db = getDb();
  const out = await db.transaction(async (tx) => {
    const [i] = await tx.select().from(invites).where(eq(invites.tokenHash, hash(token))).for("update").limit(1);
    if (!i || i.revokedAt) throw new HttpError(404, "This invite link isn't valid. Ask for a new one.", "invite_invalid");
    if (i.acceptedAt) throw new HttpError(410, "This invite was already used. Ask for a new one.", "invite_used");
    if (i.expiresAt < new Date()) throw new HttpError(410, "This invite expired. Ask for a new one.", "invite_expired");
    if (i.email && i.email !== u.email.toLowerCase()) {
      throw new HttpError(403, `This invite is for ${i.email}. Sign in with that email, or ask for a link for ${u.email}.`, "invite_wrong_email");
    }
    await tx.insert(memberships).values({ workspaceId: i.workspaceId, userId: u.id, role: i.role }).onConflictDoNothing();
    await tx
      .update(invites)
      .set({ uses: sql`${invites.uses} + 1`, ...(i.email ? { acceptedAt: new Date(), acceptedBy: u.id } : {}) })
      .where(eq(invites.id, i.id));
    const [p] = await tx
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.workspaceId, i.workspaceId), isNull(projects.deletedAt)))
      .orderBy(asc(projects.createdAt))
      .limit(1);
    return { workspaceId: i.workspaceId, inviteId: i.id, projectId: p?.id ?? null };
  });
  await audit({ workspaceId: out.workspaceId, actorUserId: u.id, action: "invite.accept", target: out.inviteId, req: req ?? undefined });
  return out;
}

/**
 * New accounts get a personal workspace only when they need one: someone who signed up through a team invite goes
 * straight into the team's project instead of an empty workspace of their own.
 */
export async function ensurePersonalWorkspace(u: { id: string; name: string | null }) {
  const db = getDb();
  await db.transaction(async (tx) => {
    // one at a time per user, so two tabs can't create two workspaces
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`ws:${u.id}`}))`);
    const [has] = await tx.select({ w: memberships.workspaceId }).from(memberships).where(eq(memberships.userId, u.id)).limit(1);
    if (has) return;
    const [w] = await tx
      .insert(workspaces)
      .values({ name: `${u.name?.split(" ")[0] || "My"}'s workspace` })
      .returning();
    await tx.insert(memberships).values({ workspaceId: w!.id, userId: u.id, role: "owner" });
    await tx.insert(projects).values({ workspaceId: w!.id, name: "My product", timezone: "UTC" });
  });
}
