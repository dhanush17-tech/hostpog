import "server-only";
import { runInvestigation, type EvidenceRecord } from "@hostpog/ai";
import { after } from "next/server";
import { aiUsage, evidence as evidenceTable, getDb, investigations } from "@hostpog/db";
import { eq } from "drizzle-orm";
import type { ProjectAccess } from "./authz";
import { assertBudget, loadProvider, modelFor } from "./ai";
import { providerFor, resolveSource } from "./sources";

/**
 * Investigations run in the web process (bounded: steps, tool calls, tokens,
 * wall-clock). Progress is persisted after every tool call so the UI can poll.
 * A durable worker queue is planned (PLAN.md); a process restart marks running
 * investigations as failed on next read.
 */
const running = new Map<string, AbortController>();

export function cancelInvestigation(id: string) {
  const c = running.get(id);
  if (c) c.abort();
  return Boolean(c);
}

export function isRunning(id: string) {
  return running.has(id);
}

export async function startInvestigation(a: ProjectAccess, input: { question: string; providerId: string; sourceId?: string | null }) {
  const db = getDb();
  const prov = await loadProvider(a.workspace.id, input.providerId);
  await assertBudget(a.workspace.id, prov);
  const model = await modelFor(a.workspace.id, prov);
  const src = await resolveSource(a, input.sourceId);
  const analytics = await providerFor(a, src);

  const [row] = await db
    .insert(investigations)
    .values({
      projectId: a.project.id,
      sourceId: src.id,
      title: input.question.slice(0, 120),
      question: input.question,
      status: "running",
      providerId: prov.id,
      model: prov.model,
      createdBy: a.user.id,
    })
    .returning();
  const id = row!.id;
  const ctl = new AbortController();
  running.set(id, ctl);

  // `after` keeps the work alive past the 202 response on serverless hosts (Vercel); on a normal server it just runs.
  const work = (async () => {
    try {
      const res = await runInvestigation({
        model,
        provider: analytics,
        question: input.question,
        allowRawEvents: prov.allowRawEvents,
        signal: ctl.signal,
        onEvidence: async (e: EvidenceRecord) => {
          await db.insert(evidenceTable).values({
            id: `${id}:${e.id}`,
            investigationId: id,
            seq: e.seq,
            tool: e.tool,
            input: e.input,
            output: e.output,
            meta: e.meta as unknown as Record<string, unknown>,
          });
        },
      });
      await db
        .update(investigations)
        .set({
          status: "complete",
          title: res.report.title.slice(0, 200),
          report: { ...res.report, finishedBy: res.finishedBy, validationNotes: res.validationNotes } as unknown as Record<string, unknown>,
          usage: res.usage,
          updatedAt: new Date(),
        })
        .where(eq(investigations.id, id));
      await db.insert(aiUsage).values({
        workspaceId: a.workspace.id,
        projectId: a.project.id,
        providerId: prov.id,
        model: prov.model,
        inputTokens: res.usage.inputTokens,
        outputTokens: res.usage.outputTokens,
        requests: res.usage.requests,
      });
    } catch (e) {
      const aborted = ctl.signal.aborted;
      await db
        .update(investigations)
        .set({
          status: aborted ? "cancelled" : "failed",
          error: aborted ? "Cancelled by user" : (e as Error).message.replace(/(sk|key|token)[-_a-z0-9]{6,}/gi, "[redacted]").slice(0, 500),
          updatedAt: new Date(),
        })
        .where(eq(investigations.id, id));
    } finally {
      running.delete(id);
    }
  })();
  after(() => work);

  return row!;
}
