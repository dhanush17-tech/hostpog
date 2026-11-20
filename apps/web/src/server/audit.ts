import "server-only";
import { auditLog, getDb } from "@hostpog/db";

/** Append-only audit trail for access, configuration, credential and deletion events. Never log secrets. */
export async function audit(e: {
  workspaceId?: string | null;
  projectId?: string | null;
  actorUserId?: string | null;
  action: string;
  target?: string;
  meta?: Record<string, unknown>;
  req?: Request;
}) {
  const ip = e.req?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  await getDb()
    .insert(auditLog)
    .values({
      workspaceId: e.workspaceId ?? null,
      projectId: e.projectId ?? null,
      actorUserId: e.actorUserId ?? null,
      action: e.action,
      target: e.target,
      meta: e.meta ?? {},
      ip,
    });
}
