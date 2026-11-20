import { auditLog, getDb } from "@hostpog/db";
import { desc, eq } from "drizzle-orm";
import { requireWorkspace } from "@/server/authz";
import { ok, route } from "@/server/http";

type Ctx = { params: Promise<{ workspaceId: string }> };

export const GET = route<Ctx>(async (_req, { params }) => {
  const { workspaceId } = await params;
  await requireWorkspace(workspaceId, "admin");
  const rows = await getDb().select().from(auditLog).where(eq(auditLog.workspaceId, workspaceId)).orderBy(desc(auditLog.createdAt)).limit(200);
  return ok({ entries: rows });
});
