import "server-only";
import { runAssistant, type AssistantCard } from "@hostpog/ai";
import { aiProviders, aiUsage, getDb } from "@hostpog/db";
import { tool, type ModelMessage } from "ai";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { assertBudget, loadProvider, modelFor } from "./ai";
import { hasRole, type ProjectAccess } from "./authz";
import { HttpError } from "./http";
import { createExperiment, createFlag, createSurvey, createWorkflow, ExperimentInput, FlagInput, listFlags, listSurveys, listWorkflows, SurveyInput, WorkflowInput } from "./products";
import { providerFor, resolveSource } from "./sources";

export const AssistantRequest = z.object({
  messages: z
    .array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(8000) }))
    .min(1)
    .max(30),
  providerId: z.string().uuid().optional(),
  sourceId: z.string().uuid().optional(),
});

const errText = (e: unknown) =>
  e instanceof z.ZodError ? e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") : e instanceof HttpError ? e.message : "Couldn't save it.";

const Key = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,99}$/).describe("lowercase key, letters/numbers/-/_");
const Condition = z.object({
  property: z.string().max(200).describe("person property, e.g. email or plan"),
  operator: z.enum(["eq", "neq", "contains", "not_contains", "in", "gt", "lt", "is_set", "is_not_set"]),
  value: z.union([z.string(), z.number(), z.array(z.string())]).optional(),
});

function actionTools(a: ProjectAccess, req: Request, card: (c: AssistantCard) => void) {
  const href = (path: string) => `/app/p/${a.project.id}/${path}`;
  const guard = () => {
    if (!hasRole(a.role, "member")) throw new HttpError(403, "Viewers can't create things in this project.");
  };
  const run = async <T,>(fn: () => Promise<T>) => {
    try {
      guard();
      return await fn();
    } catch (e) {
      return { error: errText(e) } as const;
    }
  };
  return {
    create_feature_flag: tool({
      description: "Create a feature flag (created inactive). Optional rollout %, person-property conditions, and variants that add up to 100.",
      inputSchema: z.object({
        key: Key,
        name: z.string().max(200).default(""),
        rolloutPercent: z.number().int().min(0).max(100).default(100),
        conditions: z.array(Condition).max(10).default([]),
        variants: z.array(z.object({ key: Key, rolloutPercent: z.number().int().min(0).max(100) })).max(5).default([]),
      }),
      execute: (i) =>
        run(async () => {
          const f = await createFlag(a, req, FlagInput.parse({ ...i, active: false, conditions: i.conditions.map((c) => ({ type: "person", ...c })) }));
          card({ type: "created", kind: "flag", name: f.key, href: href(`flags/${f.id}`), note: "Inactive until you turn it on" });
          return { created: "flag", id: f.id, key: f.key, active: false };
        }),
    }),
    create_experiment: tool({
      description: "Create an A/B experiment with its own control/test flag. goalEvent is the event that counts as a conversion. Not launched until the user launches it.",
      inputSchema: z.object({
        name: z.string().min(1).max(200),
        hypothesis: z.string().max(2000).default(""),
        goalEvent: z.string().min(1).max(200),
        variants: z.array(z.object({ key: Key, rolloutPercent: z.number().int().min(0).max(100) })).min(2).max(5).optional(),
      }),
      execute: (i) =>
        run(async () => {
          const e = await createExperiment(a, req, ExperimentInput.parse(i));
          card({ type: "created", kind: "experiment", name: e.name, href: href(`experiments/${e.id}`), note: "Draft: launch it when ready" });
          return { created: "experiment", id: e.id, launched: false };
        }),
    }),
    create_survey: tool({
      description: "Create an in-app survey (as a draft). Shown by posthog-js's survey widget once launched. Question types: open, rating (scale 3/5/7/10), single_choice, multiple_choice (with choices).",
      inputSchema: z.object({
        name: z.string().min(1).max(200),
        questions: z
          .array(
            z.object({
              type: z.enum(["open", "rating", "single_choice", "multiple_choice"]),
              question: z.string().min(1).max(500),
              scale: z.union([z.literal(3), z.literal(5), z.literal(7), z.literal(10)]).optional(),
              choices: z.array(z.string().max(200)).max(10).optional(),
            }),
          )
          .min(1)
          .max(5),
        urlContains: z.string().max(500).default("").describe("only show on pages whose URL contains this; empty for all pages"),
      }),
      execute: (i) =>
        run(async () => {
          const s = await createSurvey(a, req, SurveyInput.parse(i));
          card({ type: "created", kind: "survey", name: s.name, href: href(`surveys/${s.id}`), note: "Draft: preview and launch" });
          return { created: "survey", id: s.id, status: "draft" };
        }),
    }),
    create_workflow: tool({
      description: "Create a workflow (disabled) that sends a Slack message or webhook when an event happens. Needs the user's Slack incoming-webhook URL or webhook URL; ask for it if you don't have one. Message can use {event}, {distinct_id}, {timestamp} and {properties.<key>}.",
      inputSchema: z.object({
        name: z.string().min(1).max(200),
        event: z.string().min(1).max(200),
        filters: z
          .array(z.object({ property: z.string().max(200), operator: z.enum(["eq", "neq", "contains", "is_set", "gt", "lt"]), value: z.union([z.string(), z.number()]).optional() }))
          .max(5)
          .default([]),
        action: z.object({ type: z.enum(["slack", "webhook"]), url: z.string().max(2000), message: z.string().max(2000).optional() }),
      }),
      execute: (i) =>
        run(async () => {
          const w = await createWorkflow(a, req, WorkflowInput.parse({ name: i.name, enabled: false, trigger: { type: "event", event: i.event, filters: i.filters }, action: i.action }));
          card({ type: "created", kind: "workflow", name: w.name, href: href(`workflows/${w.id}`), note: "Off: send a test, then turn it on" });
          return { created: "workflow", id: w.id, enabled: false };
        }),
    }),
  };
}

/** The provider the assistant uses: an explicit one, else the enabled provider that last tested OK (untested next, failing last). */
export async function pickAiProvider(workspaceId: string, providerId?: string) {
  if (providerId) return loadProvider(workspaceId, providerId);
  const rows = await getDb()
    .select()
    .from(aiProviders)
    .where(and(eq(aiProviders.workspaceId, workspaceId), eq(aiProviders.enabled, true)))
    .orderBy(desc(aiProviders.createdAt));
  const rank = (p: (typeof rows)[number]) => (p.lastTestResult?.startsWith("ok") ? 0 : p.lastTestResult ? 2 : 1);
  const p = [...rows].sort((a, b) => rank(a) - rank(b))[0];
  if (!p) throw new HttpError(412, "Connect an AI model first.", "no_ai_provider");
  return p;
}

export async function askAssistant(a: ProjectAccess, req: Request, input: z.infer<typeof AssistantRequest>) {
  const prov = await pickAiProvider(a.workspace.id, input.providerId);
  await assertBudget(a.workspace.id, prov);
  const model = await modelFor(a.workspace.id, prov);
  const src = await resolveSource(a, input.sourceId);
  const analytics = await providerFor(a, src);
  const [flags, surveys, workflows] = await Promise.all([listFlags(a.project.id), listSurveys(a.project.id), listWorkflows(a.project.id)]);
  const context = [
    `Project: ${a.project.name}.`,
    flags.length ? `Existing flags: ${flags.slice(0, 30).map((f) => f.key).join(", ")}.` : "No feature flags yet.",
    surveys.length ? `Existing surveys: ${surveys.slice(0, 15).map((s) => s.name).join(", ")}.` : "",
    workflows.length ? `Existing workflows: ${workflows.slice(0, 15).map((w) => w.name).join(", ")}.` : "",
  ]
    .filter(Boolean)
    .join("\n");

  try {
    const res = await runAssistant({
      model,
      provider: analytics,
      messages: input.messages as ModelMessage[],
      actions: (card) => actionTools(a, req, card),
      projectContext: context,
      allowRawEvents: prov.allowRawEvents,
      signal: req.signal,
    });
    await getDb().insert(aiUsage).values({
      workspaceId: a.workspace.id,
      projectId: a.project.id,
      providerId: prov.id,
      model: prov.model,
      inputTokens: res.usage.inputTokens,
      outputTokens: res.usage.outputTokens,
      requests: res.usage.requests,
    });
    return { reply: res.text, cards: res.cards, model: prov.model, provider: prov.label };
  } catch (e) {
    if (e instanceof HttpError) throw e;
    const msg = (e as Error).message.replace(/(sk|key|token)[-_a-z0-9]{6,}/gi, "[redacted]").slice(0, 300);
    // remember the failure on the provider so Settings shows it, and the next pick prefers a working model
    await getDb().update(aiProviders).set({ lastTestedAt: new Date(), lastTestResult: `failed: ${msg}`.slice(0, 220) }).where(eq(aiProviders.id, prov.id));
    throw new HttpError(502, `${prov.label} (${prov.model}) failed: ${msg}`, "ai_error");
  }
}
