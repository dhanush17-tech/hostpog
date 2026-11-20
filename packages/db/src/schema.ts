/**
 * HostPog control-plane schema (PostgreSQL).
 * Every project-scoped table carries project_id; every workspace-scoped table
 * carries workspace_id. Authorization is enforced in apps/web/src/server/authz.ts.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const ts = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const createdAt = () => ts("created_at").notNull().defaultNow();

/* ---------------- Better Auth core tables ---------------- */

export const user = pgTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const session = pgTable("session", {
  id: text("id").primaryKey(),
  expiresAt: ts("expires_at").notNull(),
  token: text("token").notNull().unique(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
});

export const account = pgTable("account", {
  id: text("id").primaryKey(),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  userId: text("user_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" }),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: ts("access_token_expires_at"),
  refreshTokenExpiresAt: ts("refresh_token_expires_at"),
  scope: text("scope"),
  password: text("password"),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const verification = pgTable("verification", {
  id: text("id").primaryKey(),
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: ts("expires_at").notNull(),
  createdAt: ts("created_at").notNull().defaultNow(),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const rateLimit = pgTable("rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

/* ---------------- Tenancy ---------------- */

export const workspaces = pgTable("workspaces", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

/**
 * Invite links. The token itself is never stored, only its SHA-256. An invite bound to an email is single-use and only
 * that address can accept it; an open link (no email) can be used by anyone holding it until it expires or is revoked.
 */
export const invites = pgTable(
  "invites",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull().unique(),
    email: text("email"),
    role: text("role", { enum: ["admin", "member", "viewer"] }).notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    expiresAt: ts("expires_at").notNull(),
    acceptedAt: ts("accepted_at"),
    acceptedBy: text("accepted_by").references(() => user.id, { onDelete: "set null" }),
    uses: integer("uses").notNull().default(0),
    revokedAt: ts("revoked_at"),
  },
  (t) => [index("invites_workspace_idx").on(t.workspaceId)],
);

export const memberships = pgTable(
  "memberships",
  {
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    role: text("role", { enum: ["owner", "admin", "member", "viewer"] }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.workspaceId, t.userId] }), index("memberships_user_idx").on(t.userId)],
);

export const projects = pgTable(
  "projects",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    timezone: text("timezone").notNull().default("UTC"),
    /** which source answers queries by default; never summed with others */
    primarySourceId: uuid("primary_source_id"),
    createdAt: createdAt(),
    deletedAt: ts("deleted_at"),
  },
  (t) => [index("projects_workspace_idx").on(t.workspaceId)],
);

/* ---------------- Sources & credentials ---------------- */

export const credentials = pgTable("credentials", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["posthog_api_key", "posthog_oauth", "ai_api_key"] }).notNull(),
  /** AES-256-GCM envelope, see crypto.ts */
  ciphertext: text("ciphertext").notNull(),
  keyVersion: integer("key_version").notNull(),
  /** non-secret display hint, e.g. "phx_…MEu" */
  hint: text("hint").notNull(),
  expiresAt: ts("expires_at"),
  createdAt: createdAt(),
  rotatedAt: ts("rotated_at"),
});

export interface PostHogSourceConfig {
  region: "us" | "eu" | "self_hosted";
  host: string;
  organizationId: string | null;
  externalProjectId: string;
  externalProjectName: string;
  timezone: string;
  authMethod: "api_key" | "oauth";
  scopes: string[] | null;
}

export const sources = pgTable(
  "sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: ["posthog", "native", "imported", "demo"] }).notNull(),
    label: text("label").notNull(),
    status: text("status", { enum: ["active", "error", "disconnected"] }).notNull().default("active"),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    credentialId: uuid("credential_id").references(() => credentials.id, { onDelete: "set null" }),
    lastSuccessAt: ts("last_success_at"),
    lastError: text("last_error"),
    createdAt: createdAt(),
    disconnectedAt: ts("disconnected_at"),
  },
  (t) => [index("sources_project_idx").on(t.projectId)],
);

export const ingestionKeys = pgTable(
  "ingestion_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    /** public, write-only key embedded in client apps */
    publicKey: text("public_key").notNull(),
    allowedOrigins: text("allowed_origins").array().notNull().default(sql`'{}'::text[]`),
    createdAt: createdAt(),
    revokedAt: ts("revoked_at"),
  },
  (t) => [uniqueIndex("ingestion_keys_public_key_idx").on(t.publicKey)],
);

/* ---------------- Analytics objects ---------------- */

export const insights = pgTable(
  "insights",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id").references(() => sources.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    query: jsonb("query").$type<Record<string, unknown>>().notNull(),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("insights_project_idx").on(t.projectId)],
);

export const dashboards = pgTable(
  "dashboards",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    dateFrom: text("date_from").notNull().default("-7d"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("dashboards_project_idx").on(t.projectId)],
);

export const dashboardTiles = pgTable("dashboard_tiles", {
  id: uuid("id").primaryKey().defaultRandom(),
  dashboardId: uuid("dashboard_id")
    .notNull()
    .references(() => dashboards.id, { onDelete: "cascade" }),
  insightId: uuid("insight_id")
    .notNull()
    .references(() => insights.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
});

/* ---------------- AI ---------------- */

export const aiProviders = pgTable("ai_providers", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: uuid("workspace_id")
    .notNull()
    .references(() => workspaces.id, { onDelete: "cascade" }),
  provider: text("provider", { enum: ["openai", "anthropic", "google", "openrouter", "openai_compatible"] }).notNull(),
  label: text("label").notNull(),
  baseUrl: text("base_url"),
  model: text("model").notNull(),
  credentialId: uuid("credential_id").references(() => credentials.id, { onDelete: "set null" }),
  monthlyTokenBudget: integer("monthly_token_budget").notNull().default(2_000_000),
  allowRawEvents: boolean("allow_raw_events").notNull().default(false),
  enabled: boolean("enabled").notNull().default(true),
  lastTestedAt: ts("last_tested_at"),
  lastTestResult: text("last_test_result"),
  createdAt: createdAt(),
});

export const investigations = pgTable(
  "investigations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sourceId: uuid("source_id").references(() => sources.id, { onDelete: "set null" }),
    title: text("title").notNull(),
    question: text("question").notNull(),
    status: text("status", { enum: ["running", "complete", "failed", "cancelled"] }).notNull(),
    providerId: uuid("provider_id").references(() => aiProviders.id, { onDelete: "set null" }),
    model: text("model"),
    report: jsonb("report").$type<Record<string, unknown>>(),
    usage: jsonb("usage").$type<{ inputTokens: number; outputTokens: number; requests: number; toolCalls: number }>(),
    error: text("error"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("investigations_project_idx").on(t.projectId)],
);

export const evidence = pgTable(
  "evidence",
  {
    id: text("id").primaryKey(),
    investigationId: uuid("investigation_id")
      .notNull()
      .references(() => investigations.id, { onDelete: "cascade" }),
    seq: integer("seq").notNull(),
    tool: text("tool").notNull(),
    input: jsonb("input").$type<Record<string, unknown>>().notNull(),
    /** redacted + truncated tool output as given to the model */
    output: jsonb("output").$type<unknown>().notNull(),
    /** provenance: source, range, timezone, queries, fingerprint */
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("evidence_investigation_idx").on(t.investigationId)],
);

export const aiUsage = pgTable(
  "ai_usage",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id").references(() => projects.id, { onDelete: "set null" }),
    providerId: uuid("provider_id").references(() => aiProviders.id, { onDelete: "set null" }),
    model: text("model").notNull(),
    inputTokens: integer("input_tokens").notNull(),
    outputTokens: integer("output_tokens").notNull(),
    requests: integer("requests").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("ai_usage_workspace_idx").on(t.workspaceId, t.createdAt)],
);

/* ---------------- Security & ops ---------------- */

export const auditLog = pgTable(
  "audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workspaceId: uuid("workspace_id").references(() => workspaces.id, { onDelete: "cascade" }),
    projectId: uuid("project_id"),
    actorUserId: text("actor_user_id"),
    action: text("action").notNull(),
    target: text("target"),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [index("audit_workspace_idx").on(t.workspaceId, t.createdAt)],
);

export const oauthStates = pgTable("oauth_states", {
  state: text("state").primaryKey(),
  workspaceId: uuid("workspace_id").notNull(),
  projectId: uuid("project_id").notNull(),
  userId: text("user_id").notNull(),
  region: text("region").notNull(),
  host: text("host").notNull(),
  redirectUri: text("redirect_uri").notNull(),
  codeVerifierCiphertext: text("code_verifier_ciphertext").notNull(),
  createdAt: createdAt(),
  expiresAt: ts("expires_at").notNull(),
  usedAt: ts("used_at"),
});

/* ---------------- Native identity (source of truth for merges) ----------------
 * Partitioned by source id so native, demo and imported datasets never mix. */

export const nativePersons = pgTable(
  "native_persons",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** storage partition = the native/demo/imported source that owns this data */
    partitionId: uuid("partition_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    properties: jsonb("properties").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    isIdentified: boolean("is_identified").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("native_persons_partition_idx").on(t.partitionId, t.createdAt)],
);

export const nativePersonDistinctIds = pgTable(
  "native_person_distinct_ids",
  {
    partitionId: uuid("partition_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    distinctId: text("distinct_id").notNull(),
    personId: uuid("person_id")
      .notNull()
      .references(() => nativePersons.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.partitionId, t.distinctId] }), index("npdi_person_idx").on(t.personId)],
);

/* ---------------- Move off PostHog ---------------- */

export interface ProductUsageReport {
  checkedAt: string;
  windowDays: number;
  products: {
    key: string;
    label: string;
    inUse: boolean | null;
    detail: string;
    hostpogSupport: "supported" | "not_yet" | "manual";
    blocksCutover: boolean;
  }[];
}

/** One migration per HostPog project: PostHog source → HostPog native source. */
export const migrations = pgTable(
  "migrations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    posthogSourceId: uuid("posthog_source_id").references(() => sources.id, { onDelete: "set null" }),
    nativeSourceId: uuid("native_source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    /** public PostHog project token (phc_…), verified against the connected project's api_token */
    posthogProjectToken: text("posthog_project_token"),
    /** PostHog public capture host, e.g. https://us.i.posthog.com */
    captureHost: text("capture_host").notNull(),
    assetsHost: text("assets_host").notNull(),
    /** while true, HostPog forwards a copy of every request to PostHog (parallel run) */
    forwarding: boolean("forwarding").notNull().default(true),
    productUsage: jsonb("product_usage").$type<ProductUsageReport>(),
    trackingFirstSeenAt: ts("tracking_first_seen_at"),
    trackingLastSeenAt: ts("tracking_last_seen_at"),
    capturedViaProxy: integer("captured_via_proxy").notNull().default(0),
    forwardedRequests: integer("forwarded_requests").notNull().default(0),
    forwardFailures: integer("forward_failures").notNull().default(0),
    lastForwardError: text("last_forward_error"),
    acknowledgedGaps: jsonb("acknowledged_gaps").$type<string[]>().notNull().default(sql`'[]'::jsonb`),
    status: text("status", { enum: ["in_progress", "cut_over", "rolled_back"] }).notNull().default("in_progress"),
    cutoverAt: ts("cutover_at"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("migrations_project_idx").on(t.projectId), uniqueIndex("migrations_token_idx").on(t.posthogProjectToken)],
);

export const importJobs = pgTable(
  "import_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    migrationId: uuid("migration_id")
      .notNull()
      .references(() => migrations.id, { onDelete: "cascade" }),
    method: text("method", { enum: ["api", "file", "s3"] }).notNull(),
    status: text("status", { enum: ["queued", "running", "paused", "complete", "failed", "cancelled"] }).notNull(),
    phase: text("phase", { enum: ["persons", "events", "done"] }).notNull().default("persons"),
    rangeFrom: ts("range_from").notNull(),
    rangeTo: ts("range_to").notNull(),
    /** resumable checkpoint */
    cursor: jsonb("cursor").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    estimatedRows: integer("estimated_rows"),
    importedEvents: integer("imported_events").notNull().default(0),
    importedPersons: integer("imported_persons").notNull().default(0),
    duplicateEvents: integer("duplicate_events").notNull().default(0),
    failedRows: integer("failed_rows").notNull().default(0),
    failures: jsonb("failures").$type<{ at: string; reason: string }[]>().notNull().default(sql`'[]'::jsonb`),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    error: text("error"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    startedAt: ts("started_at"),
    finishedAt: ts("finished_at"),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("import_jobs_migration_idx").on(t.migrationId)],
);

/* ---------------- Product suite: flags, experiments, surveys, workflows ---------------- */

export interface FlagCondition {
  /** person property key, or "$distinct_id" */
  property: string;
  operator: "eq" | "neq" | "contains" | "not_contains" | "is_set" | "is_not_set" | "gt" | "lt" | "in";
  value?: string | number | string[];
}
export interface FlagVariant {
  key: string;
  /** 0-100, all variants of a flag add up to 100 */
  rolloutPercent: number;
}

export const featureFlags = pgTable(
  "feature_flags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    key: text("key").notNull(),
    name: text("name").notNull().default(""),
    active: boolean("active").notNull().default(true),
    /** share of matching users who get the flag, 0-100 */
    rolloutPercent: integer("rollout_percent").notNull().default(100),
    /** all conditions must match (AND); empty = everyone */
    conditions: jsonb("conditions").$type<FlagCondition[]>().notNull().default(sql`'[]'::jsonb`),
    /** multivariate when non-empty */
    variants: jsonb("variants").$type<FlagVariant[]>().notNull().default(sql`'[]'::jsonb`),
    /** JSON payload per value ("true" or a variant key) */
    payloads: jsonb("payloads").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    version: integer("version").notNull().default(1),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("feature_flags_project_key_idx").on(t.projectId, t.key)],
);

export const experiments = pgTable(
  "experiments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    flagId: uuid("flag_id")
      .notNull()
      .references(() => featureFlags.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    hypothesis: text("hypothesis").notNull().default(""),
    /** the event that counts as a conversion */
    goalEvent: text("goal_event").notNull(),
    status: text("status", { enum: ["draft", "running", "stopped"] }).notNull().default("draft"),
    startedAt: ts("started_at"),
    endedAt: ts("ended_at"),
    /** variant the team shipped when stopping, if any */
    shippedVariant: text("shipped_variant"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("experiments_project_idx").on(t.projectId)],
);

export interface SurveyQuestion {
  id: string;
  type: "open" | "rating" | "single_choice" | "multiple_choice";
  question: string;
  description?: string;
  /** rating: 3 | 5 | 7 | 10; NPS is a 10-point rating with isNps */
  scale?: number;
  isNps?: boolean;
  display?: "number" | "emoji";
  lowerBoundLabel?: string;
  upperBoundLabel?: string;
  choices?: string[];
  optional?: boolean;
}

export const surveys = pgTable(
  "surveys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    status: text("status", { enum: ["draft", "active", "stopped"] }).notNull().default("draft"),
    questions: jsonb("questions").$type<SurveyQuestion[]>().notNull().default(sql`'[]'::jsonb`),
    /** show only on URLs containing this text; empty = everywhere */
    urlContains: text("url_contains").notNull().default(""),
    /** don't show again to someone who answered/dismissed for this many days */
    waitDays: integer("wait_days").notNull().default(30),
    thankYouMessage: text("thank_you_message").notNull().default("Thanks for the feedback!"),
    startedAt: ts("started_at"),
    endedAt: ts("ended_at"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("surveys_project_idx").on(t.projectId)],
);

export interface WorkflowTrigger {
  type: "event";
  event: string;
  /** all must match (event properties) */
  filters: { property: string; operator: "eq" | "neq" | "contains" | "is_set" | "gt" | "lt"; value?: string | number }[];
}
export interface WorkflowAction {
  type: "webhook" | "slack";
  url: string;
  /** Slack: message text with {event}, {distinct_id}, {properties.x}. Webhook: ignored (full event JSON is posted). */
  message?: string;
}

export const workflows = pgTable(
  "workflows",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    trigger: jsonb("trigger").$type<WorkflowTrigger>().notNull(),
    action: jsonb("action").$type<WorkflowAction>().notNull(),
    lastRunAt: ts("last_run_at"),
    createdBy: text("created_by").references(() => user.id, { onDelete: "set null" }),
    createdAt: createdAt(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("workflows_project_idx").on(t.projectId)],
);

export const workflowRuns = pgTable(
  "workflow_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    workflowId: uuid("workflow_id")
      .notNull()
      .references(() => workflows.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["pending", "success", "failed"] }).notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: ts("next_attempt_at").notNull().defaultNow(),
    /** the triggering event (trimmed) */
    event: jsonb("event").$type<Record<string, unknown>>().notNull(),
    responseStatus: integer("response_status"),
    error: text("error"),
    test: boolean("test").notNull().default(false),
    createdAt: createdAt(),
    finishedAt: ts("finished_at"),
  },
  (t) => [index("workflow_runs_workflow_idx").on(t.workflowId, t.createdAt), index("workflow_runs_pending_idx").on(t.status, t.nextAttemptAt)],
);
