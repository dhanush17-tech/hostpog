import { DateExpr } from "@hostpog/contracts";
import { dashboards, dashboardTiles, getDb, insights } from "@hostpog/db";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { requireProject } from "@/server/authz";
import { body, HttpError, ok, route } from "@/server/http";

type Ctx = { params: Promise<{ projectId: string; dashboardId: string }> };

async function load(projectId: string, dashboardId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(dashboardId)) throw new HttpError(404, "Dashboard not found");
  const [d] = await getDb().select().from(dashboards).where(and(eq(dashboards.id, dashboardId), eq(dashboards.projectId, projectId))).limit(1);
  if (!d) throw new HttpError(404, "Dashboard not found");
  return d;
}

export const GET = route<Ctx>(async (_req, { params }) => {
  const { projectId, dashboardId } = await params;
  await requireProject(projectId);
  const d = await load(projectId, dashboardId);
  const tiles = await getDb()
    .select({ tile: dashboardTiles, insight: insights })
    .from(dashboardTiles)
    .innerJoin(insights, eq(insights.id, dashboardTiles.insightId))
    .where(eq(dashboardTiles.dashboardId, d.id))
    .orderBy(asc(dashboardTiles.position));
  return ok({ dashboard: d, tiles: tiles.map((t) => ({ id: t.tile.id, position: t.tile.position, insight: t.insight })) });
});

const Patch = z.object({
  name: z.string().min(1).max(120).optional(),
  dateFrom: DateExpr.optional(),
  addInsightId: z.string().uuid().optional(),
  removeTileId: z.string().uuid().optional(),
  order: z.array(z.string().uuid()).max(100).optional(),
});

export const PATCH = route<Ctx>(async (req, { params }) => {
  const { projectId, dashboardId } = await params;
  await requireProject(projectId, "member", req);
  const d = await load(projectId, dashboardId);
  const b = await body(req, Patch);
  const db = getDb();
  if (b.name || b.dateFrom) await db.update(dashboards).set({ ...(b.name ? { name: b.name } : {}), ...(b.dateFrom ? { dateFrom: b.dateFrom } : {}), updatedAt: new Date() }).where(eq(dashboards.id, d.id));
  if (b.addInsightId) {
    const [i] = await db.select().from(insights).where(and(eq(insights.id, b.addInsightId), eq(insights.projectId, projectId))).limit(1);
    if (!i) throw new HttpError(404, "Insight not found in this project");
    const existing = await db.select().from(dashboardTiles).where(eq(dashboardTiles.dashboardId, d.id));
    await db.insert(dashboardTiles).values({ dashboardId: d.id, insightId: i.id, position: existing.length });
  }
  if (b.removeTileId) await db.delete(dashboardTiles).where(and(eq(dashboardTiles.id, b.removeTileId), eq(dashboardTiles.dashboardId, d.id)));
  if (b.order) {
    const tiles = await db.select().from(dashboardTiles).where(and(eq(dashboardTiles.dashboardId, d.id), inArray(dashboardTiles.id, b.order)));
    if (tiles.length !== b.order.length) throw new HttpError(400, "Order must list this dashboard's tiles");
    await Promise.all(b.order.map((id, position) => db.update(dashboardTiles).set({ position }).where(eq(dashboardTiles.id, id))));
  }
  return ok({ updated: true });
});

export const DELETE = route<Ctx>(async (req, { params }) => {
  const { projectId, dashboardId } = await params;
  await requireProject(projectId, "member", req);
  const d = await load(projectId, dashboardId);
  await getDb().delete(dashboards).where(eq(dashboards.id, d.id));
  return ok({ deleted: true });
});
