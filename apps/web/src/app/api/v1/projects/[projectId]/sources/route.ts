import { credentials, getDb, ingestionKeys } from "@hostpog/db";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { hasRole, requireProject } from "@/server/authz";
import { ok, route } from "@/server/http";
import { projectSources, sourceStats } from "@/server/sources";

type Ctx = { params: Promise<{ projectId: string }> };

/** Sources for a project. Never returns secrets — only non-secret hints. */
export const GET = route<Ctx>(async (req, { params }) => {
  const { projectId } = await params;
  const a = await requireProject(projectId);
  const all = new URL(req.url).searchParams.get("all") === "1";
  const list = await projectSources(projectId, all);
  const db = getDb();
  const credIds = list.map((s) => s.credentialId).filter((x): x is string => Boolean(x));
  const creds = credIds.length
    ? await db.select({ id: credentials.id, hint: credentials.hint, kind: credentials.kind, createdAt: credentials.createdAt, rotatedAt: credentials.rotatedAt, expiresAt: credentials.expiresAt }).from(credentials).where(inArray(credentials.id, credIds))
    : [];
  const keys = list.length
    ? await db.select().from(ingestionKeys).where(and(inArray(ingestionKeys.sourceId, list.map((s) => s.id)), isNull(ingestionKeys.revokedAt)))
    : [];
  return ok({
    primarySourceId: a.project.primarySourceId,
    sources: list.map((s) => ({
      id: s.id,
      kind: s.kind,
      label: s.label,
      status: s.status,
      config: s.config,
      createdAt: s.createdAt,
      lastSuccessAt: s.lastSuccessAt,
      lastError: s.lastError,
      credential: creds.find((c) => c.id === s.credentialId) ?? null,
      stats: sourceStats(s.id),
      // project keys are public by design (write-only), but only members+ need them
      ingestionKeys: hasRole(a.role, "member") ? keys.filter((k) => k.sourceId === s.id).map((k) => ({ id: k.id, publicKey: k.publicKey, allowedOrigins: k.allowedOrigins, createdAt: k.createdAt })) : [],
    })),
  });
});
