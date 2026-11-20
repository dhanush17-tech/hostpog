/**
 * Delivers queued workflow runs (webhook or Slack) with retries. Runs inside the ingest server.
 * Destinations are user-supplied URLs, so every request goes through the SSRF guard (no private addresses,
 * no redirects, https only unless an operator allows a private host).
 */
import { guardedFetch, normalizeEndpoint } from "@hostpog/ai";
import { getDb, workflowRuns, workflows, type WorkflowAction } from "@hostpog/db";
import { and, asc, eq, lte } from "drizzle-orm";

type Log = { info: (o: unknown, m?: string) => void; error: (o: unknown, m?: string) => void };
const BACKOFF_MS = [30_000, 120_000, 600_000];
const MAX_ATTEMPTS = BACKOFF_MS.length + 1;

/** Fill {event}, {distinct_id}, {timestamp} and {properties.key} placeholders. */
export function renderMessage(template: string, ev: Record<string, unknown>): string {
  const props = (ev.properties ?? {}) as Record<string, unknown>;
  // {key}; {{key}} is accepted too since it's the common habit from other tools
  return template.replace(/\{\{?\s*([a-zA-Z_$][\w$.]*)\s*\}?\}/g, (m, key: string) => {
    const v = key.startsWith("properties.") ? props[key.slice(11)] : ev[key];
    if (v === undefined || v === null) return m;
    return typeof v === "object" ? JSON.stringify(v) : String(v);
  });
}

export function buildRequest(action: WorkflowAction, wf: { id: string; name: string }, ev: Record<string, unknown>): { body: string; headers: Record<string, string> } {
  if (action.type === "slack") {
    const text = renderMessage(action.message || "*{event}* from `{distinct_id}`", ev);
    return { body: JSON.stringify({ text }), headers: { "content-type": "application/json" } };
  }
  return {
    body: JSON.stringify({ workflow: { id: wf.id, name: wf.name }, event: ev, sent_at: new Date().toISOString() }),
    headers: { "content-type": "application/json", "user-agent": "HostPog-Workflows/1", "x-hostpog-workflow": wf.id },
  };
}

export async function deliverRun(runId: string, log?: Log): Promise<"success" | "failed" | "retry"> {
  const db = getDb();
  const [row] = await db
    .select({ run: workflowRuns, wf: workflows })
    .from(workflowRuns)
    .innerJoin(workflows, eq(workflows.id, workflowRuns.workflowId))
    .where(eq(workflowRuns.id, runId))
    .limit(1);
  if (!row || row.run.status !== "pending") return "failed";
  const attempts = row.run.attempts + 1;
  let status: number | null = null;
  let error: string | null = null;
  try {
    const url = normalizeEndpoint(row.wf.action.url);
    const req = buildRequest(row.wf.action, row.wf, row.run.event);
    const res = await guardedFetch(url)(url.toString(), { method: "POST", headers: req.headers, body: req.body, signal: AbortSignal.timeout(10_000) });
    status = res.status;
    await res.arrayBuffer().catch(() => undefined);
    if (!res.ok) error = `Destination answered ${res.status}`;
  } catch (e) {
    error = (e as Error).message.slice(0, 300);
  }
  const ok = !error;
  const giveUp = !ok && (attempts >= MAX_ATTEMPTS || (status !== null && status >= 400 && status < 500 && status !== 429));
  await db
    .update(workflowRuns)
    .set({
      attempts,
      responseStatus: status,
      error,
      status: ok ? "success" : giveUp ? "failed" : "pending",
      nextAttemptAt: new Date(Date.now() + (BACKOFF_MS[attempts - 1] ?? 600_000)),
      ...(ok || giveUp ? { finishedAt: new Date() } : {}),
    })
    .where(eq(workflowRuns.id, runId));
  await db.update(workflows).set({ lastRunAt: new Date() }).where(eq(workflows.id, row.wf.id));
  if (!ok) log?.info({ runId, attempts, error }, giveUp ? "workflow run failed" : "workflow run will retry");
  return ok ? "success" : giveUp ? "failed" : "retry";
}

/** Poll for due runs. A run is claimed by bumping next_attempt_at, so parallel workers don't double-send. */
export function startWorkflowDelivery(log: Log, opts: { intervalMs?: number } = {}) {
  const db = getDb();
  let busy = false;
  let stopped = false;
  const tick = async () => {
    if (busy || stopped) return;
    busy = true;
    try {
      const due = await db
        .select({ id: workflowRuns.id, next: workflowRuns.nextAttemptAt })
        .from(workflowRuns)
        .where(and(eq(workflowRuns.status, "pending"), lte(workflowRuns.nextAttemptAt, new Date())))
        .orderBy(asc(workflowRuns.nextAttemptAt))
        .limit(50);
      for (const r of due) {
        // claim: only proceed if nobody else moved it in the meantime
        const claimed = await db
          .update(workflowRuns)
          .set({ nextAttemptAt: new Date(Date.now() + 60_000) })
          .where(and(eq(workflowRuns.id, r.id), eq(workflowRuns.status, "pending"), eq(workflowRuns.nextAttemptAt, r.next)))
          .returning({ id: workflowRuns.id });
        if (claimed.length) await deliverRun(r.id, log);
      }
    } catch (e) {
      log.error({ err: (e as Error).message }, "workflow delivery poll failed");
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void tick(), opts.intervalMs ?? 2000);
  void tick();
  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
