import { z } from "zod";
import { requireWorkspace } from "@/server/authz";
import { body, HttpError, ok, route } from "@/server/http";
import { createInvite, listInvites, revokeInvite } from "@/server/invites";

type Ctx = { params: Promise<{ workspaceId: string }> };

export const GET = route<Ctx>(async (req, { params }) => {
  const { workspaceId } = await params;
  await requireWorkspace(workspaceId, "admin", req);
  return ok({ invites: await listInvites(workspaceId) });
});

/** Invite by email (existing accounts are added at once), or create an open team link (no email). */
export const POST = route<Ctx>(async (req, { params }) => {
  const { workspaceId } = await params;
  const a = await requireWorkspace(workspaceId, "admin", req);
  const b = await body(req, z.object({ email: z.string().trim().email().max(320).optional().or(z.literal("")), role: z.enum(["admin", "member", "viewer"]).default("member") }));
  if (b.role === "admin" && a.role !== "owner") throw new HttpError(403, "Only owners can invite admins.", "forbidden");
  return ok(await createInvite({ workspaceId, actorId: a.user.id, email: b.email || null, role: b.role, req }), { status: 201 });
});

export const DELETE = route<Ctx>(async (req, { params }) => {
  const { workspaceId } = await params;
  const a = await requireWorkspace(workspaceId, "admin", req);
  const id = new URL(req.url).searchParams.get("id");
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(400, "Which invite?");
  await revokeInvite(workspaceId, id, a.user.id, req);
  return ok({ revoked: true });
});
