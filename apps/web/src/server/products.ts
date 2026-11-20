import "server-only";
import { randomUUID } from "node:crypto";
import type { FunnelResult } from "@hostpog/contracts";
import { experiments, featureFlags, getDb, surveys, workflowRuns, workflows } from "@hostpog/db";
import { evaluateFlag } from "@hostpog/native";
import { normalizeEndpoint, EndpointPolicyError } from "@hostpog/ai";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { audit } from "./audit";
import type { ProjectAccess } from "./authz";
import { HttpError } from "./http";
import { providerFor, resolveSource } from "./sources";

/* ---------------- validation ---------------- */

const Key = z
  .string()
  .trim()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,99}$/, "Use letters, numbers, - and _ (no spaces), up to 100 characters.");
const PropKey = z.string().trim().min(1).max(200);

export const FlagCondition = z.object({
  property: PropKey,
  operator: z.enum(["eq", "neq", "contains", "not_contains", "is_set", "is_not_set", "gt", "lt", "in"]),
  value: z.union([z.string().max(500), z.number(), z.array(z.string().max(200)).max(200)]).optional(),
});
export const FlagVariant = z.object({ key: Key, rolloutPercent: z.number().int().min(0).max(100) });

export const FlagInput = z
  .object({
    key: Key,
    name: z.string().trim().max(200).default(""),
    active: z.boolean().default(true),
    rolloutPercent: z.number().int().min(0).max(100).default(100),
    conditions: z.array(FlagCondition).max(20).default([]),
    variants: z.array(FlagVariant).max(10).default([]),
    payloads: z.record(z.string(), z.unknown()).default({}),
  })
  .superRefine((f, ctx) => {
    if (f.variants.length === 1) ctx.addIssue({ code: "custom", path: ["variants"], message: "Add at least two variants, or none." });
    if (f.variants.length > 1) {
      const sum = f.variants.reduce((a, v) => a + v.rolloutPercent, 0);
      if (sum !== 100) ctx.addIssue({ code: "custom", path: ["variants"], message: `Variant splits add up to ${sum}%. They need to add up to 100%.` });
      if (new Set(f.variants.map((v) => v.key)).size !== f.variants.length) ctx.addIssue({ code: "custom", path: ["variants"], message: "Variant keys must be unique." });
    }
  });
export type FlagInput = z.infer<typeof FlagInput>;

/* ---------------- flags ---------------- */

export async function listFlags(projectId: string) {
  const db = getDb();
  const rows = await db.select().from(featureFlags).where(eq(featureFlags.projectId, projectId)).orderBy(desc(featureFlags.updatedAt));
  const exps = rows.length ? await db.select({ id: experiments.id, flagId: experiments.flagId, name: experiments.name, status: experiments.status }).from(experiments).where(inArray(experiments.flagId, rows.map((r) => r.id))) : [];
  return rows.map((r) => ({ ...r, experiment: exps.find((e) => e.flagId === r.id) ?? null }));
}

export async function getFlag(projectId: string, id: string) {
  const [f] = await getDb()
    .select()
    .from(featureFlags)
    .where(and(eq(featureFlags.projectId, projectId), eq(featureFlags.id, id)))
    .limit(1);
  if (!f) throw new HttpError(404, "Flag not found");
  return f;
}

export async function createFlag(a: ProjectAccess, req: Request, input: FlagInput) {
  const db = getDb();
  const [dup] = await db
    .select({ id: featureFlags.id })
    .from(featureFlags)
    .where(and(eq(featureFlags.projectId, a.project.id), eq(featureFlags.key, input.key)))
    .limit(1);
  if (dup) throw new HttpError(409, `A flag with the key "${input.key}" already exists.`, "duplicate_key");
  const [f] = await db
    .insert(featureFlags)
    .values({ ...input, projectId: a.project.id, createdBy: a.user.id })
    .returning();
  await audit({ workspaceId: a.workspace.id, projectId: a.project.id, actorUserId: a.user.id, action: "flag.create", target: f!.id, meta: { key: input.key }, req });
  return f!;
}

export async function updateFlag(a: ProjectAccess, req: Request, id: string, patch: Partial<FlagInput>) {
  const cur = await getFlag(a.project.id, id);
  const next = FlagInput.parse({ ...cur, ...patch });
  if (next.key !== cur.key) {
    const [dup] = await getDb()
      .select({ id: featureFlags.id })
      .from(featureFlags)
      .where(and(eq(featureFlags.projectId, a.project.id), eq(featureFlags.key, next.key)))
      .limit(1);
    if (dup) throw new HttpError(409, `A flag with the key "${next.key}" already exists.`, "duplicate_key");
  }
  const [f] = await getDb()
    .update(featureFlags)
    .set({ ...next, version: cur.version + 1, updatedAt: new Date() })
    .where(eq(featureFlags.id, id))
    .returning();
  await audit({ workspaceId: a.workspace.id, projectId: a.project.id, actorUserId: a.user.id, action: "flag.update", target: id, meta: { key: next.key, active: next.active }, req });
  return f!;
}

export async function deleteFlag(a: ProjectAccess, req: Request, id: string) {
  const f = await getFlag(a.project.id, id);
  const [exp] = await getDb().select().from(experiments).where(eq(experiments.flagId, id)).limit(1);
  if (exp?.status === "running") throw new HttpError(409, `This flag runs the experiment "${exp.name}". Stop the experiment first.`, "experiment_running");
  await getDb().delete(featureFlags).where(eq(featureFlags.id, id));
  await audit({ workspaceId: a.workspace.id, projectId: a.project.id, actorUserId: a.user.id, action: "flag.delete", target: id, meta: { key: f.key }, req });
}

/** What would this user get? Used by the "Test a user" box in the flag editor. */
export function previewFlag(input: FlagInput, distinctId: string, props: Record<string, unknown>) {
  return evaluateFlag({ id: "preview", ...input, version: 0 }, distinctId, props);
}

/* ---------------- experiments ---------------- */

export const ExperimentInput = z.object({
  name: z.string().trim().min(1, "Give the experiment a name.").max(200),
  hypothesis: z.string().trim().max(2000).default(""),
  goalEvent: z.string().trim().min(1, "Pick the event that counts as a conversion.").max(200),
  /** existing multivariate flag to use; otherwise a new flag is created */
  flagId: z.string().uuid().optional(),
  flagKey: Key.optional(),
  variants: z.array(FlagVariant).min(2).max(5).optional(),
});

function slug(s: string) {
  return (
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "experiment"
  );
}

export async function listExperiments(projectId: string) {
  return getDb()
    .select({ e: experiments, flagKey: featureFlags.key, variants: featureFlags.variants })
    .from(experiments)
    .innerJoin(featureFlags, eq(featureFlags.id, experiments.flagId))
    .where(eq(experiments.projectId, projectId))
    .orderBy(desc(experiments.createdAt));
}

export async function getExperiment(projectId: string, id: string) {
  const [row] = await getDb()
    .select({ e: experiments, flag: featureFlags })
    .from(experiments)
    .innerJoin(featureFlags, eq(featureFlags.id, experiments.flagId))
    .where(and(eq(experiments.projectId, projectId), eq(experiments.id, id)))
    .limit(1);
  if (!row) throw new HttpError(404, "Experiment not found");
  return row;
}

export async function createExperiment(a: ProjectAccess, req: Request, input: z.infer<typeof ExperimentInput>) {
  const db = getDb();
  let flagId = input.flagId;
  if (flagId) {
    const f = await getFlag(a.project.id, flagId);
    if (f.variants.length < 2) throw new HttpError(400, "That flag has no variants. Experiments need a flag with at least two variants.", "flag_not_multivariate");
  } else {
    let key = input.flagKey ?? slug(input.name);
    const taken = new Set((await db.select({ k: featureFlags.key }).from(featureFlags).where(eq(featureFlags.projectId, a.project.id))).map((r) => r.k));
    for (let i = 2; taken.has(key); i++) key = `${slug(input.name)}-${i}`;
    const variants = input.variants ?? [
      { key: "control", rolloutPercent: 50 },
      { key: "test", rolloutPercent: 50 },
    ];
    const f = await createFlag(a, req, FlagInput.parse({ key, name: input.name, active: false, variants }));
    flagId = f.id;
  }
  const [e] = await db
    .insert(experiments)
    .values({ projectId: a.project.id, flagId: flagId!, name: input.name, hypothesis: input.hypothesis, goalEvent: input.goalEvent, createdBy: a.user.id })
    .returning();
  await audit({ workspaceId: a.workspace.id, projectId: a.project.id, actorUserId: a.user.id, action: "experiment.create", target: e!.id, req });
  return e!;
}

export async function experimentAction(a: ProjectAccess, req: Request, id: string, action: "start" | "stop" | "ship" | "reset", variant?: string) {
  const { e, flag } = await getExperiment(a.project.id, id);
  const db = getDb();
  if (action === "start") {
    if (e.status === "running") return e;
    await db.update(featureFlags).set({ active: true, version: flag.version + 1, updatedAt: new Date() }).where(eq(featureFlags.id, flag.id));
    const [n] = await db.update(experiments).set({ status: "running", startedAt: e.startedAt ?? new Date(), endedAt: null, updatedAt: new Date() }).where(eq(experiments.id, id)).returning();
    await audit({ workspaceId: a.workspace.id, projectId: a.project.id, actorUserId: a.user.id, action: "experiment.start", target: id, req });
    return n!;
  }
  if (action === "stop" || action === "ship") {
    if (action === "ship") {
      if (!variant || !flag.variants.some((v) => v.key === variant)) throw new HttpError(400, "Pick one of the experiment's variants to ship.");
      // everyone now gets the shipped variant (same key, so code paths keep working)
      await db
        .update(featureFlags)
        .set({ variants: flag.variants.map((v) => ({ key: v.key, rolloutPercent: v.key === variant ? 100 : 0 })), active: true, version: flag.version + 1, updatedAt: new Date() })
        .where(eq(featureFlags.id, flag.id));
    }
    const [n] = await db
      .update(experiments)
      .set({ status: "stopped", endedAt: e.endedAt ?? new Date(), shippedVariant: action === "ship" ? variant! : e.shippedVariant, updatedAt: new Date() })
      .where(eq(experiments.id, id))
      .returning();
    await audit({ workspaceId: a.workspace.id, projectId: a.project.id, actorUserId: a.user.id, action: `experiment.${action}`, target: id, meta: variant ? { variant } : undefined, req });
    return n!;
  }
  const [n] = await db.update(experiments).set({ status: "draft", startedAt: null, endedAt: null, shippedVariant: null, updatedAt: new Date() }).where(eq(experiments.id, id)).returning();
  return n!;
}

/* ---- statistics ---- */

function gaussian(rand: () => number) {
  let u = 0;
  let v = 0;
  while (u === 0) u = rand();
  while (v === 0) v = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
/** Marsaglia–Tsang gamma sampler (shape >= 1; boosted for < 1). */
function gamma(shape: number, rand: () => number): number {
  if (shape < 1) return gamma(shape + 1, rand) * Math.pow(rand(), 1 / shape);
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = gaussian(rand);
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = rand();
    if (u < 1 - 0.0331 * x ** 4 || Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}
function beta(a: number, b: number, rand: () => number) {
  const x = gamma(a, rand);
  return x / (x + gamma(b, rand));
}
/** seeded PRNG so a result page doesn't flicker between reloads */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Wilson score interval, 95% */
function wilson(conv: number, n: number): [number, number] {
  if (!n) return [0, 0];
  const z = 1.96;
  const p = conv / n;
  const den = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / den;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / den;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

export interface VariantResult {
  key: string;
  exposed: number;
  converted: number;
  rate: number;
  interval: [number, number];
  /** relative lift vs control (null for control / no data) */
  lift: number | null;
  chanceToBeBest: number;
}

export function computeExperimentStats(variants: { key: string; exposed: number; converted: number }[], control: string) {
  const rand = mulberry32(variants.reduce((a, v) => a * 31 + v.exposed * 7 + v.converted, 17));
  const SAMPLES = 20_000;
  const wins = new Map(variants.map((v) => [v.key, 0]));
  for (let i = 0; i < SAMPLES; i++) {
    let best = "";
    let bestV = -1;
    for (const v of variants) {
      const s = beta(v.converted + 1, Math.max(v.exposed - v.converted, 0) + 1, rand);
      if (s > bestV) {
        bestV = s;
        best = v.key;
      }
    }
    wins.set(best, (wins.get(best) ?? 0) + 1);
  }
  const c = variants.find((v) => v.key === control);
  const cRate = c && c.exposed ? c.converted / c.exposed : 0;
  const out: VariantResult[] = variants.map((v) => {
    const rate = v.exposed ? v.converted / v.exposed : 0;
    return {
      key: v.key,
      exposed: v.exposed,
      converted: v.converted,
      rate,
      interval: wilson(v.converted, v.exposed),
      lift: v.key === control || !cRate ? null : (rate - cRate) / cRate,
      chanceToBeBest: (wins.get(v.key) ?? 0) / SAMPLES,
    };
  });
  const enough = variants.every((v) => v.exposed >= 50);
  const leader = [...out].sort((a, b) => b.chanceToBeBest - a.chanceToBeBest)[0];
  const significant = Boolean(enough && leader && leader.chanceToBeBest >= 0.95);
  let verdict: string;
  if (!variants.some((v) => v.exposed > 0)) verdict = "No one has been exposed yet. Make sure your code calls the flag (posthog.getFeatureFlag or hostpog.getFeatureFlag).";
  else if (!enough) verdict = `Too early to call: each variant needs at least 50 exposed users (lowest so far: ${Math.min(...variants.map((v) => v.exposed))}).`;
  else if (significant && leader!.key === control) verdict = `Control is winning with ${(leader!.chanceToBeBest * 100).toFixed(0)}% probability. The change isn't helping.`;
  else if (significant) verdict = `"${leader!.key}" is winning with ${(leader!.chanceToBeBest * 100).toFixed(0)}% probability${leader!.lift !== null ? ` (${leader!.lift >= 0 ? "+" : ""}${(leader!.lift * 100).toFixed(1)}% vs control)` : ""}.`;
  else verdict = `No clear winner yet. "${leader!.key}" leads with ${(leader!.chanceToBeBest * 100).toFixed(0)}% probability; keep it running until one variant passes 95%.`;
  return { variants: out, significant, winner: significant ? leader!.key : null, verdict };
}

export async function experimentResults(a: ProjectAccess, id: string, sourceId?: string | null) {
  const { e, flag } = await getExperiment(a.project.id, id);
  if (!e.startedAt) return { experiment: e, flag, results: null, source: null };
  const src = await resolveSource(a, sourceId);
  const provider = await providerFor(a, src);
  const to = (e.endedAt ?? new Date()).toISOString();
  const env = await provider.query({
    kind: "funnel",
    steps: [
      { event: "$feature_flag_called", filters: [{ type: "event", key: "$feature_flag", operator: "eq", value: flag.key }] },
      { event: e.goalEvent, filters: [] },
    ],
    windowSeconds: 90 * 86400,
    dateRange: { from: e.startedAt.toISOString(), to },
    breakdown: { type: "event", key: "$feature_flag_response", limit: 10 },
    filters: [],
  });
  const r = env.result as FunnelResult;
  const known = new Set(flag.variants.map((v) => v.key));
  const byKey = new Map((r.breakdowns ?? []).filter((b) => b.value !== null && known.has(b.value)).map((b) => [b.value!, b]));
  const rows = flag.variants.map((v) => {
    const b = byKey.get(v.key);
    return { key: v.key, exposed: b?.steps[0]?.count ?? 0, converted: b?.steps[1]?.count ?? 0 };
  });
  const control = flag.variants.find((v) => v.key === "control")?.key ?? flag.variants[0]!.key;
  return { experiment: e, flag, control, source: { id: src.id, kind: src.kind, label: src.label }, provenance: env, results: computeExperimentStats(rows, control) };
}

/* ---------------- surveys ---------------- */

const SurveyQuestion = z
  .object({
    id: z.string().max(60).default(() => randomUUID()),
    type: z.enum(["open", "rating", "single_choice", "multiple_choice"]),
    question: z.string().trim().min(1, "Every question needs text.").max(500),
    description: z.string().max(1000).optional(),
    scale: z.union([z.literal(3), z.literal(5), z.literal(7), z.literal(10)]).optional(),
    isNps: z.boolean().optional(),
    display: z.enum(["number", "emoji"]).optional(),
    lowerBoundLabel: z.string().max(60).optional(),
    upperBoundLabel: z.string().max(60).optional(),
    choices: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
    optional: z.boolean().optional(),
  })
  .superRefine((q, ctx) => {
    if ((q.type === "single_choice" || q.type === "multiple_choice") && (q.choices?.length ?? 0) < 2) ctx.addIssue({ code: "custom", path: ["choices"], message: "Add at least two choices." });
  });

export const SurveyInput = z.object({
  name: z.string().trim().min(1, "Give the survey a name.").max(200),
  questions: z.array(SurveyQuestion).min(1, "Add at least one question.").max(10),
  urlContains: z.string().trim().max(500).default(""),
  waitDays: z.number().int().min(0).max(365).default(30),
  thankYouMessage: z.string().trim().max(300).default("Thanks for the feedback!"),
});

export async function listSurveys(projectId: string) {
  return getDb().select().from(surveys).where(eq(surveys.projectId, projectId)).orderBy(desc(surveys.updatedAt));
}
export async function getSurvey(projectId: string, id: string) {
  const [s] = await getDb()
    .select()
    .from(surveys)
    .where(and(eq(surveys.projectId, projectId), eq(surveys.id, id)))
    .limit(1);
  if (!s) throw new HttpError(404, "Survey not found");
  return s;
}

export async function surveyResults(a: ProjectAccess, id: string, sourceId?: string | null) {
  const s = await getSurvey(a.project.id, id);
  const src = await resolveSource(a, sourceId);
  const provider = await providerFor(a, src);
  const from = (s.startedAt ?? s.createdAt).toISOString();
  const dateRange = { from, to: (s.endedAt ?? new Date()).toISOString() };
  const idFilter = [{ type: "event" as const, key: "$survey_id", operator: "eq" as const, value: s.id }];
  const [sent, shown, dismissed] = await Promise.all(
    ["survey sent", "survey shown", "survey dismissed"].map((event) =>
      provider.query({ kind: "trend", series: [{ event, math: "unique_users", filters: idFilter }], interval: "day", dateRange, compare: false, filters: [] }),
    ),
  );
  const rows = await provider.query({ kind: "events", event: "survey sent", filters: idFilter, dateRange, limit: 200 });
  const responses = rows.result.rows.map((r) => ({ at: r.timestamp, distinctId: r.distinctId, props: r.properties as Record<string, unknown> }));
  const questions = s.questions.map((q, i) => {
    const key = `$survey_response_${q.id}`;
    const values = responses.map((r) => r.props[key] ?? (i === 0 ? r.props.$survey_response : undefined)).filter((v) => v !== undefined && v !== null && v !== "");
    if (q.type === "rating") {
      const nums = values.map(Number).filter((n) => Number.isFinite(n));
      const scale = q.isNps ? 10 : (q.scale ?? 5);
      const dist = Array.from({ length: q.isNps ? 11 : scale }, (_, k) => {
        const val = q.isNps ? k : k + 1;
        return { value: String(val), count: nums.filter((n) => n === val).length };
      });
      const avg = nums.length ? nums.reduce((x, y) => x + y, 0) / nums.length : null;
      const nps = q.isNps && nums.length ? Math.round(((nums.filter((n) => n >= 9).length - nums.filter((n) => n <= 6).length) / nums.length) * 100) : null;
      return { id: q.id, type: q.type, question: q.question, answered: nums.length, average: avg, nps, distribution: dist };
    }
    if (q.type === "single_choice" || q.type === "multiple_choice") {
      const flat = values.flatMap((v) => (Array.isArray(v) ? v.map(String) : [String(v)]));
      const counts = new Map<string, number>();
      for (const v of flat) counts.set(v, (counts.get(v) ?? 0) + 1);
      return { id: q.id, type: q.type, question: q.question, answered: values.length, distribution: [...(q.choices ?? []), ...[...counts.keys()].filter((k) => !(q.choices ?? []).includes(k))].map((c) => ({ value: c, count: counts.get(c) ?? 0 })) };
    }
    return { id: q.id, type: q.type, question: q.question, answered: values.length, answers: responses.flatMap((r) => (r.props[key] ? [{ at: r.at, distinctId: r.distinctId, text: String(r.props[key]) }] : [])).slice(0, 100) };
  });
  const total = (env: { result: unknown } | undefined) => (env?.result as { series: { total: number }[] } | undefined)?.series[0]?.total ?? 0;
  return { survey: s, source: { id: src.id, kind: src.kind, label: src.label }, shown: total(shown), dismissed: total(dismissed), responses: total(sent), questions };
}

/* ---------------- workflows ---------------- */

export const WorkflowInput = z.object({
  name: z.string().trim().min(1, "Give the workflow a name.").max(200),
  enabled: z.boolean().default(true),
  trigger: z.object({
    type: z.literal("event").default("event"),
    event: z.string().trim().min(1, "Pick the event that starts this workflow.").max(200),
    filters: z
      .array(z.object({ property: PropKey, operator: z.enum(["eq", "neq", "contains", "is_set", "gt", "lt"]), value: z.union([z.string().max(500), z.number()]).optional() }))
      .max(10)
      .default([]),
  }),
  action: z
    .object({ type: z.enum(["webhook", "slack"]), url: z.string().trim().url("Enter a full URL starting with https://").max(2000), message: z.string().max(2000).optional() })
    .superRefine((a, ctx) => {
      try {
        normalizeEndpoint(a.url);
      } catch (e) {
        ctx.addIssue({ code: "custom", path: ["url"], message: e instanceof EndpointPolicyError ? `This URL isn't allowed: ${e.message}.` : "Invalid URL." });
      }
      if (a.type === "slack" && !/^https:\/\/hooks\.slack\.com\//.test(a.url)) ctx.addIssue({ code: "custom", path: ["url"], message: "Paste a Slack incoming-webhook URL (https://hooks.slack.com/…)." });
    }),
});

export async function listWorkflows(projectId: string) {
  const db = getDb();
  const rows = await db.select().from(workflows).where(eq(workflows.projectId, projectId)).orderBy(desc(workflows.updatedAt));
  if (!rows.length) return [];
  const recent = await db
    .select({ workflowId: workflowRuns.workflowId, status: workflowRuns.status })
    .from(workflowRuns)
    .where(inArray(workflowRuns.workflowId, rows.map((r) => r.id)))
    .orderBy(desc(workflowRuns.createdAt))
    .limit(500);
  return rows.map((w) => {
    const mine = recent.filter((r) => r.workflowId === w.id);
    return { ...w, recentRuns: mine.length, recentFailures: mine.filter((r) => r.status === "failed").length };
  });
}
export async function getWorkflow(projectId: string, id: string) {
  const [w] = await getDb()
    .select()
    .from(workflows)
    .where(and(eq(workflows.projectId, projectId), eq(workflows.id, id)))
    .limit(1);
  if (!w) throw new HttpError(404, "Workflow not found");
  return w;
}
export async function workflowRunsFor(workflowId: string, limit = 50) {
  return getDb().select().from(workflowRuns).where(eq(workflowRuns.workflowId, workflowId)).orderBy(desc(workflowRuns.createdAt)).limit(limit);
}
/** Queue a test delivery with a sample event; the ingest server sends it within a couple of seconds. */
export async function testWorkflow(projectId: string, id: string) {
  const w = await getWorkflow(projectId, id);
  const [r] = await getDb()
    .insert(workflowRuns)
    .values({ workflowId: w.id, test: true, event: { uuid: randomUUID(), event: w.trigger.event, distinct_id: "test-user", timestamp: new Date().toISOString(), properties: { $current_url: "https://example.com/test", test: true } } })
    .returning();
  return r!;
}

/* ---------------- shared creators (API routes and the assistant) ---------------- */

export async function createSurvey(a: ProjectAccess, req: Request, input: z.infer<typeof SurveyInput>) {
  const [s] = await getDb().insert(surveys).values({ ...input, projectId: a.project.id, createdBy: a.user.id }).returning();
  await audit({ workspaceId: a.workspace.id, projectId: a.project.id, actorUserId: a.user.id, action: "survey.create", target: s!.id, req });
  return s!;
}

export async function createWorkflow(a: ProjectAccess, req: Request, input: z.infer<typeof WorkflowInput>) {
  const [w] = await getDb().insert(workflows).values({ ...input, projectId: a.project.id, createdBy: a.user.id }).returning();
  await audit({ workspaceId: a.workspace.id, projectId: a.project.id, actorUserId: a.user.id, action: "workflow.create", target: w!.id, req });
  return w!;
}
