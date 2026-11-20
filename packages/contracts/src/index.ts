/**
 * HostPog shared contracts (v1).
 *
 * The metric DSL is the only query surface exposed to the UI and to the AI agent.
 * Providers compile it into parameterized, source-specific queries. Nothing here
 * accepts raw SQL.
 */
import { z } from "zod";

export const CONTRACT_VERSION = "2026-11-18.v1";

/* ------------------------------------------------------------------ */
/* Identifiers                                                         */
/* ------------------------------------------------------------------ */

/** Event names: generous but bounded; rejects control characters. */
export const EventName = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[^\u0000-\u001f\u007f]+$/, "event name contains control characters");

/** Property keys are interpolated as escaped literals, so restrict the alphabet. */
export const PropertyKey = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[$A-Za-z0-9_.:\- ]+$/, "unsupported characters in property key");

export const PropertyType = z.enum(["event", "person"]);

export const FilterOperator = z.enum([
  "eq",
  "neq",
  "contains",
  "not_contains",
  "is_set",
  "is_not_set",
  "gt",
  "lt",
]);
export type FilterOperator = z.infer<typeof FilterOperator>;

export const PropertyFilter = z
  .object({
    type: PropertyType.default("event"),
    key: PropertyKey,
    operator: FilterOperator,
    value: z.union([z.string().max(1000), z.number()]).optional(),
  })
  .refine(
    (f) => f.operator === "is_set" || f.operator === "is_not_set" || f.value !== undefined,
    "value is required for this operator",
  );
export type PropertyFilter = z.infer<typeof PropertyFilter>;

/* ------------------------------------------------------------------ */
/* Date ranges                                                         */
/* ------------------------------------------------------------------ */

/** Relative ("-7d", "-24h", "-3m" months) or absolute ISO-8601 datetimes. */
export const DateExpr = z
  .string()
  .regex(/^(-\d{1,4}[hdwm]|now|\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2})?)?)$/, "invalid date expression");

export const DateRange = z.object({
  from: DateExpr.default("-7d"),
  to: DateExpr.default("now"),
});
export type DateRange = z.infer<typeof DateRange>;

export interface ResolvedRange {
  /** inclusive, ISO UTC */
  from: string;
  /** exclusive, ISO UTC */
  to: string;
}

export const Interval = z.enum(["hour", "day", "week", "month"]);
export type Interval = z.infer<typeof Interval>;

export const Breakdown = z.object({
  /** "event_name" groups by the event itself (key is ignored) */
  type: z.enum(["event", "person", "event_name"]).default("event"),
  key: PropertyKey,
  limit: z.number().int().min(1).max(25).default(10),
});
export type Breakdown = z.infer<typeof Breakdown>;

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

/** sum / avg / p95 aggregate a numeric event property (TrendSeries.property). */
export const MathType = z.enum(["total", "unique_users", "per_user_avg", "sum", "avg", "p95"]);
export type MathType = z.infer<typeof MathType>;

export const TrendSeries = z.object({
  /** null = all events */
  event: EventName.nullable(),
  math: MathType.default("total"),
  /** numeric event property for sum / avg / p95 */
  property: PropertyKey.optional(),
  label: z.string().max(120).optional(),
  filters: z.array(PropertyFilter).max(20).default([]),
});
export type TrendSeries = z.infer<typeof TrendSeries>;
export const PROPERTY_MATH: readonly MathType[] = ["sum", "avg", "p95"];

export const TrendQuery = z.object({
  kind: z.literal("trend"),
  series: z.array(TrendSeries).min(1).max(6),
  interval: Interval.default("day"),
  dateRange: DateRange.default({ from: "-7d", to: "now" }),
  breakdown: Breakdown.optional(),
  compare: z.boolean().default(false),
  filters: z.array(PropertyFilter).max(20).default([]),
});
export type TrendQuery = z.infer<typeof TrendQuery>;

export const FunnelStep = z.object({
  event: EventName,
  label: z.string().max(120).optional(),
  filters: z.array(PropertyFilter).max(20).default([]),
});

export const FunnelQuery = z.object({
  kind: z.literal("funnel"),
  steps: z.array(FunnelStep).min(2).max(10),
  /** conversion window measured from the first step */
  windowSeconds: z.number().int().min(60).max(90 * 86400).default(14 * 86400),
  dateRange: DateRange.default({ from: "-30d", to: "now" }),
  breakdown: Breakdown.optional(),
  filters: z.array(PropertyFilter).max(20).default([]),
});
export type FunnelQuery = z.infer<typeof FunnelQuery>;

export const FunnelPersonsQuery = FunnelQuery.extend({
  kind: z.literal("funnel_persons"),
  /** 1-based step index */
  step: z.number().int().min(1).max(10),
  outcome: z.enum(["reached", "dropped"]),
  limit: z.number().int().min(1).max(200).default(100),
});
export type FunnelPersonsQuery = z.infer<typeof FunnelPersonsQuery>;

export const EventsCursor = z.object({ ts: z.string(), uuid: z.string() });
export type EventsCursor = z.infer<typeof EventsCursor>;

export const EventsListQuery = z.object({
  kind: z.literal("events"),
  event: EventName.optional(),
  personId: z.string().max(200).optional(),
  distinctId: z.string().max(400).optional(),
  filters: z.array(PropertyFilter).max(20).default([]),
  dateRange: DateRange.default({ from: "-24h", to: "now" }),
  limit: z.number().int().min(1).max(200).default(50),
  cursor: EventsCursor.optional(),
});
export type EventsListQuery = z.infer<typeof EventsListQuery>;

export const TopValuesQuery = z.object({
  kind: z.literal("top"),
  event: EventName.nullable(),
  groupBy: Breakdown,
  dateRange: DateRange.default({ from: "-7d", to: "now" }),
  filters: z.array(PropertyFilter).max(20).default([]),
  limit: z.number().int().min(1).max(100).default(10),
});
export type TopValuesQuery = z.infer<typeof TopValuesQuery>;

export const SummaryQuery = z.object({
  kind: z.literal("summary"),
  dateRange: DateRange.default({ from: "-7d", to: "now" }),
});
export type SummaryQuery = z.infer<typeof SummaryQuery>;

export const WebStatsQuery = z.object({
  kind: z.literal("web"),
  dateRange: DateRange.default({ from: "-7d", to: "now" }),
});
export type WebStatsQuery = z.infer<typeof WebStatsQuery>;

export const RetentionQuery = z.object({
  kind: z.literal("retention"),
  startEvent: EventName.nullable(),
  returnEvent: EventName.nullable(),
  period: z.enum(["day", "week"]).default("day"),
  periods: z.number().int().min(2).max(12).default(8),
  dateRange: DateRange.default({ from: "-14d", to: "now" }),
});
export type RetentionQuery = z.infer<typeof RetentionQuery>;

export const PersonsQuery = z.object({
  kind: z.literal("persons"),
  search: z.string().max(200).optional(),
  identified: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).default(50),
  /** opaque cursor (created_at|id) */
  cursor: z.string().max(200).optional(),
});
export type PersonsQuery = z.infer<typeof PersonsQuery>;

export const AnalyticsQuery = z.discriminatedUnion("kind", [
  TrendQuery,
  FunnelQuery,
  FunnelPersonsQuery,
  EventsListQuery,
  TopValuesQuery,
  SummaryQuery,
  WebStatsQuery,
  RetentionQuery,
]);
export type AnalyticsQuery = z.infer<typeof AnalyticsQuery>;

/* ------------------------------------------------------------------ */
/* Results                                                             */
/* ------------------------------------------------------------------ */

export interface TrendPoint {
  t: string;
  v: number;
}
export interface TrendSeriesResult {
  label: string;
  event: string | null;
  math: MathType;
  breakdownValue?: string | null;
  points: TrendPoint[];
  total: number;
}
export interface TrendResult {
  interval: Interval;
  series: TrendSeriesResult[];
  previous?: TrendSeriesResult[];
}

export interface FunnelStepResult {
  event: string;
  label: string;
  count: number;
  conversionFromStart: number;
  conversionFromPrevious: number;
  dropOff: number;
}
export interface FunnelResult {
  steps: FunnelStepResult[];
  /** Median seconds from first occurrence of step 1 to first occurrence of the last step, among full converters. Approximate. */
  medianSecondsToConvert: number | null;
  breakdowns?: { value: string | null; steps: FunnelStepResult[] }[];
  denominator: "unique persons who performed step 1 in range";
}

export interface FunnelPersonsResult {
  persons: { personId: string; stepsCompleted: number }[];
  definition: string;
}

export interface EventRow {
  uuid: string;
  event: string;
  distinctId: string;
  personId: string | null;
  timestamp: string;
  sessionId: string | null;
  properties: Record<string, unknown>;
}
export interface EventsResult {
  rows: EventRow[];
  nextCursor: EventsCursor | null;
}

export interface TopValuesResult {
  rows: { value: string | null; count: number; uniqueUsers: number }[];
}

export interface SummaryResult {
  events: number;
  uniqueUsers: number;
  newUsers: number | null;
  previous: { events: number; uniqueUsers: number; newUsers: number | null };
}

export interface WebStatsResult {
  pageviews: number;
  visitors: number;
  sessions: number;
  /** sessions with exactly one pageview / sessions with at least one pageview */
  bounceRate: number | null;
  bounceDefinition: string;
  topPages: { value: string | null; count: number; uniqueUsers: number }[];
  entryPages: { value: string | null; count: number; uniqueUsers: number }[];
  referrers: { value: string | null; count: number; uniqueUsers: number }[];
  utmSources: { value: string | null; count: number; uniqueUsers: number }[];
  browsers: { value: string | null; count: number; uniqueUsers: number }[];
  devices: { value: string | null; count: number; uniqueUsers: number }[];
}

export interface RetentionResult {
  period: "day" | "week";
  definition: string;
  cohorts: { start: string; size: number; values: (number | null)[] }[];
}

export interface PersonRow {
  id: string;
  distinctIds: string[];
  isIdentified: boolean;
  createdAt: string | null;
  properties: Record<string, unknown>;
}
export interface PersonsResult {
  rows: PersonRow[];
  nextCursor: string | null;
}

export interface EventDefinition {
  name: string;
  volume30d: number | null;
  lastSeenAt: string | null;
}

export type ResultFor<Q extends AnalyticsQuery> = Q extends TrendQuery
  ? TrendResult
  : Q extends FunnelPersonsQuery
    ? FunnelPersonsResult
    : Q extends FunnelQuery
    ? FunnelResult
    : Q extends EventsListQuery
      ? EventsResult
      : Q extends TopValuesQuery
        ? TopValuesResult
        : Q extends SummaryQuery
          ? SummaryResult
          : Q extends WebStatsQuery
            ? WebStatsResult
            : Q extends RetentionQuery
              ? RetentionResult
              : never;

/* ------------------------------------------------------------------ */
/* Provenance envelope                                                 */
/* ------------------------------------------------------------------ */

export const SourceKind = z.enum(["posthog", "native", "imported", "demo"]);
export type SourceKind = z.infer<typeof SourceKind>;

export interface SourceRef {
  kind: SourceKind;
  sourceId: string;
  label: string;
  region?: string;
  externalProjectId?: string;
}

export interface ExecutedQuery {
  dialect: "hogql" | "clickhouse" | "postgres" | "posthog-rest";
  text: string;
  params: Record<string, unknown>;
}

export interface Envelope<T> {
  result: T;
  source: SourceRef;
  range: ResolvedRange | null;
  timezone: string;
  computedAt: string;
  /** when the provider reports a refresh time (e.g. cached PostHog result) */
  dataAsOf: string | null;
  cached: boolean;
  approximation: string | null;
  warnings: string[];
  fingerprint: string;
  queries: ExecutedQuery[];
  durationMs: number;
}

/* ------------------------------------------------------------------ */
/* Capabilities                                                        */
/* ------------------------------------------------------------------ */

export const Capability = z.enum([
  "trends",
  "funnels",
  "retention",
  "persons",
  "events",
  "web",
  "sessions",
  "replay_metadata",
  "replay_playback",
  "errors",
  "traces",
  "flags",
  "experiments",
  "saved_insights",
  "event_definitions",
]);
export type Capability = z.infer<typeof Capability>;

export interface CapabilityReport {
  supported: Capability[];
  unavailable: { capability: Capability; reason: string }[];
}

/* ------------------------------------------------------------------ */
/* Ingestion payloads (native)                                         */
/* ------------------------------------------------------------------ */

export const IngestEvent = z.object({
  uuid: z.string().uuid(),
  event: EventName,
  distinct_id: z.string().min(1).max(400),
  timestamp: z.string().datetime({ offset: true }).optional(),
  properties: z.record(z.string(), z.unknown()).default({}),
});
export type IngestEvent = z.infer<typeof IngestEvent>;

export const IngestBatch = z.object({
  api_key: z.string().min(10).max(200).optional(),
  sent_at: z.string().datetime({ offset: true }).optional(),
  batch: z.array(z.unknown()).min(1).max(500),
});
export type IngestBatch = z.infer<typeof IngestBatch>;

export const MAX_BATCH_BYTES = 1_000_000;
export const MAX_EVENT_BYTES = 64_000;

/* ------------------------------------------------------------------ */
/* Investigations                                                      */
/* ------------------------------------------------------------------ */

export const EvidenceRef = z.object({
  id: z.string(),
  description: z.string(),
});

export const InvestigationReport = z.object({
  title: z.string().max(200),
  kind: z.enum(["issue", "opportunity", "no_finding"]),
  summary: z.string().max(4000),
  baseline: z.string().max(1000).nullable(),
  current: z.string().max(1000).nullable(),
  impactEstimate: z.string().max(1000).nullable(),
  assumptions: z.array(z.string().max(500)).max(10),
  confidence: z.enum(["low", "medium", "high"]),
  confidenceReason: z.string().max(1000),
  observations: z
    .array(z.object({ statement: z.string().max(1000), evidenceIds: z.array(z.string()).min(1) }))
    .max(20),
  hypotheses: z
    .array(
      z.object({
        statement: z.string().max(1000),
        status: z.enum(["supported", "correlated", "unproven", "contradicted"]),
        evidenceIds: z.array(z.string()),
      }),
    )
    .max(10),
  affectedSegments: z.array(z.string().max(300)).max(10),
  reproductionSteps: z.array(z.string().max(500)).max(15),
  recommendation: z.string().max(2000),
  validationMetric: z.string().max(500),
  nextAction: z.string().max(500),
  limitations: z.array(z.string().max(500)).max(10),
});
export type InvestigationReport = z.infer<typeof InvestigationReport>;

/* ------------------------------------------------------------------ */
/* Roles                                                               */
/* ------------------------------------------------------------------ */

export const Role = z.enum(["owner", "admin", "member", "viewer"]);
export type Role = z.infer<typeof Role>;

export const ROLE_RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };
