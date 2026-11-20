/**
 * Product features served by the ingest server to SDKs: feature flags, surveys, remote config, and workflow triggers.
 * Definitions live in Postgres (edited in the web app) and are cached here for a few seconds per project.
 *
 * Everything speaks posthog-js's own protocol, so `posthog.init(token, { api_host: "<ingest>/ph" })` gets flags,
 * experiments and surveys from HostPog without code changes.
 */
import { randomUUID } from "node:crypto";
import {
  featureFlags,
  nativePersonDistinctIds,
  nativePersons,
  surveys,
  workflowRuns,
  workflows,
  type Db,
  type SurveyQuestion,
  type WorkflowTrigger,
} from "@hostpog/db";
import { evaluateFlag, toPostHogFlagsResponse, type FlagDefinition } from "@hostpog/native";
import { and, eq } from "drizzle-orm";

type SurveyRow = typeof surveys.$inferSelect;
type WorkflowRow = typeof workflows.$inferSelect;

interface ProjectProducts {
  flags: FlagDefinition[];
  surveys: SurveyRow[];
  workflows: WorkflowRow[];
  exp: number;
}

const TTL_MS = 5_000;

export function createProducts(db: Db) {
  const cache = new Map<string, ProjectProducts>();

  async function load(projectId: string): Promise<ProjectProducts> {
    const hit = cache.get(projectId);
    if (hit && hit.exp > Date.now()) return hit;
    const [f, s, w] = await Promise.all([
      db.select().from(featureFlags).where(eq(featureFlags.projectId, projectId)),
      db
        .select()
        .from(surveys)
        .where(and(eq(surveys.projectId, projectId), eq(surveys.status, "active"))),
      db
        .select()
        .from(workflows)
        .where(and(eq(workflows.projectId, projectId), eq(workflows.enabled, true))),
    ]);
    const v: ProjectProducts = {
      flags: f.map((r) => ({ id: r.id, key: r.key, name: r.name, active: r.active, rolloutPercent: r.rolloutPercent, conditions: r.conditions, variants: r.variants, payloads: r.payloads, version: r.version })),
      surveys: s,
      workflows: w,
      exp: Date.now() + TTL_MS,
    };
    cache.set(projectId, v);
    if (cache.size > 5000) cache.delete(cache.keys().next().value!);
    return v;
  }

  /** Stored person properties for a distinct id (empty when unknown). */
  async function personProps(partitionId: string, distinctId: string): Promise<Record<string, unknown>> {
    const rows = await db
      .select({ props: nativePersons.properties })
      .from(nativePersonDistinctIds)
      .innerJoin(nativePersons, eq(nativePersons.id, nativePersonDistinctIds.personId))
      .where(and(eq(nativePersonDistinctIds.partitionId, partitionId), eq(nativePersonDistinctIds.distinctId, distinctId)))
      .limit(1);
    return (rows[0]?.props as Record<string, unknown>) ?? {};
  }

  /** posthog-js /flags?v=2 body for one user. Request-supplied person properties win over stored ones. */
  async function flags(projectId: string, partitionId: string, req: { distinct_id?: unknown; person_properties?: unknown; flag_keys?: unknown }) {
    const p = await load(projectId);
    const distinctId = typeof req.distinct_id === "string" ? req.distinct_id : "";
    if (!distinctId || !p.flags.length) return toPostHogFlagsResponse([], [], randomUUID());
    const sent = req.person_properties && typeof req.person_properties === "object" ? (req.person_properties as Record<string, unknown>) : {};
    const needsProps = p.flags.some((f) => f.active && f.conditions.some((c) => c.property !== "$distinct_id"));
    const props = needsProps ? { ...(await personProps(partitionId, distinctId)), ...sent } : sent;
    const only = Array.isArray(req.flag_keys) ? new Set(req.flag_keys.map(String)) : null;
    const defs = only ? p.flags.filter((f) => only.has(f.key)) : p.flags;
    return toPostHogFlagsResponse(defs, defs.map((f) => evaluateFlag(f, distinctId, props)), randomUUID());
  }

  function toPostHogSurvey(s: SurveyRow) {
    return {
      id: s.id,
      name: s.name,
      description: "",
      type: "popover",
      feature_flag_keys: null,
      linked_flag_key: null,
      targeting_flag_key: null,
      internal_targeting_flag_key: null,
      questions: s.questions.map((q: SurveyQuestion) => ({
        id: q.id,
        type: q.type,
        question: q.question,
        description: q.description ?? "",
        descriptionContentType: "text",
        optional: q.optional ?? false,
        buttonText: "Submit",
        ...(q.type === "rating"
          ? { display: q.display ?? "number", scale: q.isNps ? 10 : (q.scale ?? 5), lowerBoundLabel: q.lowerBoundLabel ?? (q.isNps ? "Unlikely" : "Bad"), upperBoundLabel: q.upperBoundLabel ?? (q.isNps ? "Very likely" : "Great") }
          : {}),
        ...(q.type === "single_choice" || q.type === "multiple_choice" ? { choices: q.choices ?? [] } : {}),
      })),
      appearance: {
        position: "right",
        backgroundColor: "#ffffff",
        borderColor: "#e4e4e7",
        submitButtonColor: "#18181b",
        submitButtonTextColor: "#ffffff",
        ratingButtonActiveColor: "#ff7417",
        ratingButtonColor: "#f4f4f5",
        displayThankYouMessage: true,
        thankYouMessageHeader: s.thankYouMessage || "Thanks for the feedback!",
        whiteLabel: true,
      },
      conditions: {
        ...(s.urlContains ? { url: s.urlContains, urlMatchType: "icontains" } : {}),
        seenSurveyWaitPeriodInDays: s.waitDays,
        events: null,
        cancelEvents: null,
        actions: null,
      },
      start_date: (s.startedAt ?? s.createdAt).toISOString(),
      end_date: null,
      current_iteration: null,
      current_iteration_start_date: null,
    };
  }

  async function surveysFor(projectId: string) {
    return (await load(projectId)).surveys.map(toPostHogSurvey);
  }

  /** posthog-js remote config (/array/<token>/config). Session replay, heatmaps etc. stay off: HostPog doesn't store them. */
  async function remoteConfig(projectId: string, token: string) {
    const p = await load(projectId);
    return {
      token,
      supportedCompression: ["gzip", "gzip-js"],
      hasFeatureFlags: p.flags.some((f) => f.active),
      surveys: p.surveys.length > 0,
      autocapture_opt_out: false,
      autocaptureExceptions: false,
      capturePerformance: false,
      captureDeadClicks: false,
      heatmaps: false,
      sessionRecording: false,
      elementsChainAsString: true,
      defaultIdentifiedOnly: true,
      siteApps: [],
      toolbarParams: {},
      toolbarVersion: "toolbar",
      isAuthenticated: false,
    };
  }

  /** Queue workflow runs for events that match an enabled workflow's trigger. Never throws into ingestion. */
  async function onEvents(projectId: string, rows: Record<string, unknown>[]) {
    try {
      const p = await load(projectId);
      if (!p.workflows.length || !rows.length) return;
      const runs: (typeof workflowRuns.$inferInsert)[] = [];
      for (const r of rows) {
        let props: Record<string, unknown> = {};
        try {
          props = JSON.parse(String(r.properties ?? "{}")) as Record<string, unknown>;
        } catch {
          /* keep empty */
        }
        for (const w of p.workflows) {
          if (!triggerMatches(w.trigger, String(r.event), props)) continue;
          runs.push({ workflowId: w.id, event: { uuid: r.uuid, event: r.event, distinct_id: r.distinct_id, timestamp: r.timestamp, properties: props } });
        }
      }
      if (runs.length) await db.insert(workflowRuns).values(runs.slice(0, 1000));
    } catch (e) {
      console.error("[hostpog] workflow matching failed", (e as Error).message);
    }
  }

  return { flags, surveysFor, remoteConfig, onEvents, toPostHogSurvey, invalidate: (projectId: string) => cache.delete(projectId) };
}

export function triggerMatches(t: WorkflowTrigger, event: string, props: Record<string, unknown>): boolean {
  if (t.event && t.event !== event) return false;
  return (t.filters ?? []).every((f) => {
    const raw = props[f.property];
    const a = raw === undefined || raw === null ? null : typeof raw === "object" ? JSON.stringify(raw) : String(raw);
    const want = String(f.value ?? "");
    switch (f.operator) {
      case "is_set":
        return a !== null;
      case "eq":
        return a !== null && a.toLowerCase() === want.toLowerCase();
      case "neq":
        return a === null || a.toLowerCase() !== want.toLowerCase();
      case "contains":
        return a !== null && a.toLowerCase().includes(want.toLowerCase());
      case "gt":
        return a !== null && Number(a) > Number(want);
      case "lt":
        return a !== null && Number(a) < Number(want);
    }
  });
}

export type Products = ReturnType<typeof createProducts>;
