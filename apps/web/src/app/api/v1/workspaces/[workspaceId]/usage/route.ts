import { aiProviders, getDb, projects, sources, type PostHogSourceConfig } from "@hostpog/db";
import { getClickHouse } from "@hostpog/native";
import { sharedBudget } from "@hostpog/posthog";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { monthUsage } from "@/server/ai";
import { requireWorkspace } from "@/server/authz";
import { ok, route } from "@/server/http";
import { sourceStats } from "@/server/sources";

type Ctx = { params: Promise<{ workspaceId: string }> };

export const GET = route<Ctx>(async (_req, { params }) => {
  const { workspaceId } = await params;
  await requireWorkspace(workspaceId);
  const db = getDb();
  const projs = await db.select().from(projects).where(and(eq(projects.workspaceId, workspaceId), isNull(projects.deletedAt)));
  const srcs = projs.length ? await db.select().from(sources).where(inArray(sources.projectId, projs.map((p) => p.id))) : [];
  const nativeIds = srcs.filter((s) => s.kind !== "posthog").map((s) => s.id);
  let storage: { partition: string; events: number; bytes: number }[] = [];
  if (nativeIds.length) {
    try {
      const rs = await getClickHouse().query({
        query: `SELECT project_id AS partition, count() AS events, sum(length(properties)) AS bytes FROM events WHERE project_id IN {ids:Array(String)} GROUP BY project_id`,
        query_params: { ids: nativeIds },
        format: "JSONEachRow",
      });
      storage = ((await rs.json()) as { partition: string; events: string; bytes: string }[]).map((r) => ({ partition: r.partition, events: Number(r.events), bytes: Number(r.bytes) }));
    } catch {
      storage = [];
    }
  }
  const provs = await db.select().from(aiProviders).where(eq(aiProviders.workspaceId, workspaceId));
  return ok({
    ai: { total: await monthUsage(workspaceId), providers: await Promise.all(provs.map(async (p) => ({ id: p.id, label: p.label, budget: p.monthlyTokenBudget, usage: await monthUsage(workspaceId, p.id) }))) },
    sources: srcs.map((s) => ({
      id: s.id,
      projectId: s.projectId,
      kind: s.kind,
      label: s.label,
      status: s.status,
      stats: sourceStats(s.id),
      posthogBudget: s.kind === "posthog" && s.credentialId ? sharedBudget.usage(`${s.credentialId}`) : null,
      region: s.kind === "posthog" ? (s.config as unknown as PostHogSourceConfig).region : null,
      storage: storage.find((x) => x.partition === s.id) ?? null,
    })),
    note: "Token counts are reported by your model provider and are estimates of cost, not bills.",
  });
});
