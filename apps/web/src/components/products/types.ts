/** Shapes returned by the product APIs (flags, experiments, surveys, workflows). */

export interface FlagRow {
  id: string;
  key: string;
  name: string;
  active: boolean;
  rolloutPercent: number;
  conditions: { property: string; operator: string; value?: unknown }[];
  variants: { key: string; rolloutPercent: number }[];
  payloads: Record<string, unknown>;
  updatedAt: string;
  experiment: { id: string; name: string; status: string } | null;
}

export function rolloutSummary(f: Pick<FlagRow, "rolloutPercent" | "conditions" | "variants">) {
  const who = f.conditions.length ? `users matching ${f.conditions.length} condition${f.conditions.length > 1 ? "s" : ""}` : "all users";
  const variants = f.variants.length > 1 ? ` · ${f.variants.map((v) => `${v.key} ${v.rolloutPercent}%`).join(" / ")}` : "";
  return `${f.rolloutPercent}% of ${who}${variants}`;
}


export interface ExperimentRow {
  id: string;
  name: string;
  hypothesis: string;
  goalEvent: string;
  status: "draft" | "running" | "stopped";
  startedAt: string | null;
  endedAt: string | null;
  shippedVariant: string | null;
  flagId: string;
  flagKey: string;
  variants: { key: string; rolloutPercent: number }[];
  createdAt: string;
}

export interface VariantResult {
  key: string;
  exposed: number;
  converted: number;
  rate: number;
  interval: [number, number];
  lift: number | null;
  chanceToBeBest: number;
}

export interface ExperimentDetail {
  experiment: Omit<ExperimentRow, "flagKey" | "variants">;
  flag: FlagRow;
  control?: string;
  source: { id: string; kind: string; label: string } | null;
  results: { variants: VariantResult[]; significant: boolean; winner: string | null; verdict: string } | null;
}

export interface SurveyQuestionDraft {
  id: string;
  type: "open" | "rating" | "single_choice" | "multiple_choice";
  question: string;
  description?: string;
  scale?: 3 | 5 | 7 | 10;
  isNps?: boolean;
  display?: "number" | "emoji";
  lowerBoundLabel?: string;
  upperBoundLabel?: string;
  choices?: string[];
  optional?: boolean;
}

export interface SurveyRow {
  id: string;
  name: string;
  status: "draft" | "active" | "stopped";
  questions: SurveyQuestionDraft[];
  urlContains: string;
  waitDays: number;
  thankYouMessage: string;
  startedAt: string | null;
  endedAt: string | null;
  updatedAt: string;
}

export type QuestionResult =
  | { id: string; type: "rating"; question: string; answered: number; average: number | null; nps: number | null; distribution: { value: string; count: number }[] }
  | { id: string; type: "single_choice" | "multiple_choice"; question: string; answered: number; distribution: { value: string; count: number }[] }
  | { id: string; type: "open"; question: string; answered: number; answers: { at: string; distinctId: string; text: string }[] };

export interface SurveyResults {
  shown: number;
  dismissed: number;
  responses: number;
  source: { id: string; kind: string; label: string };
  questions: QuestionResult[];
}

export interface WorkflowRow {
  id: string;
  name: string;
  enabled: boolean;
  trigger: { type: "event"; event: string; filters: { property: string; operator: "eq" | "neq" | "contains" | "is_set" | "gt" | "lt"; value?: string | number }[] };
  action: { type: "webhook" | "slack"; url: string; message?: string };
  lastRunAt: string | null;
  updatedAt: string;
  recentRuns?: number;
  recentFailures?: number;
}

export interface WorkflowRunRow {
  id: string;
  status: "pending" | "success" | "failed";
  attempts: number;
  responseStatus: number | null;
  error: string | null;
  test: boolean;
  event: { event?: string; distinct_id?: string; properties?: Record<string, unknown> };
  createdAt: string;
  finishedAt: string | null;
}

export function describeAction(a: WorkflowRow["action"]): string {
  if (a.type === "slack") return "Post to Slack";
  try {
    return `POST to ${new URL(a.url).host}`;
  } catch {
    return "POST to a webhook";
  }
}

