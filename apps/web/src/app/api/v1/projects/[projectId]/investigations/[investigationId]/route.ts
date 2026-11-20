import { codingAgentPrompt, engineeringTicket, type EvidenceRecord } from "@hostpog/ai";
import type { InvestigationReport } from "@hostpog/contracts";
import { evidence, getDb, investigations } from "@hostpog/db";
import { and, asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireProject } from "@/server/authz";
import { body, HttpError, ok, route } from "@/server/http";
import { cancelInvestigation, isRunning } from "@/server/investigations";

type Ctx = { params: Promise<{ projectId: string; investigationId: string }> };

async function load(projectId: string, id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new HttpError(404, "Investigation not found");
  const db = getDb();
  const [row] = await db.select().from(investigations).where(and(eq(investigations.id, id), eq(investigations.projectId, projectId))).limit(1);
  if (!row) throw new HttpError(404, "Investigation not found");
  // a process restart orphans in-flight runs; surface that honestly
  if (row.status === "running" && !isRunning(row.id) && Date.now() - row.createdAt.getTime() > 5 * 60_000) {
    await db.update(investigations).set({ status: "failed", error: "Run was interrupted (server restarted)" }).where(eq(investigations.id, row.id));
    row.status = "failed";
    row.error = "Run was interrupted (server restarted)";
  }
  const ev = await db.select().from(evidence).where(eq(evidence.investigationId, row.id)).orderBy(asc(evidence.seq));
  return {
    row,
    evidence: ev.map((e) => ({ id: e.id.split(":").pop()!, seq: e.seq, tool: e.tool, input: e.input, output: e.output, meta: e.meta })) as unknown as EvidenceRecord[],
  };
}

export const GET = route<Ctx>(async (req, { params }) => {
  const { projectId, investigationId } = await params;
  await requireProject(projectId);
  const { row, evidence: ev } = await load(projectId, investigationId);
  const format = new URL(req.url).searchParams.get("format");
  if (format === "ticket" || format === "prompt") {
    if (!row.report) throw new HttpError(409, "Report not ready");
    const selected = new URL(req.url).searchParams.get("evidence")?.split(",").filter(Boolean);
    const text = format === "ticket" ? engineeringTicket(row.report as unknown as InvestigationReport, ev, selected) : codingAgentPrompt(row.report as unknown as InvestigationReport, ev, selected);
    return new NextResponse(text, { headers: { "content-type": "text/markdown; charset=utf-8" } });
  }
  return ok({ investigation: row, evidence: ev });
});

export const POST = route<Ctx>(async (req, { params }) => {
  const { projectId, investigationId } = await params;
  await requireProject(projectId, "member", req);
  const b = await body(req, z.object({ action: z.literal("cancel") }));
  await load(projectId, investigationId);
  return ok({ cancelled: b.action === "cancel" && cancelInvestigation(investigationId) });
});

export const DELETE = route<Ctx>(async (req, { params }) => {
  const { projectId, investigationId } = await params;
  await requireProject(projectId, "member", req);
  await load(projectId, investigationId);
  cancelInvestigation(investigationId);
  await getDb().delete(investigations).where(eq(investigations.id, investigationId));
  return ok({ deleted: true });
});
