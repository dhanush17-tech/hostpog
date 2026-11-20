import type {
  AnalyticsQuery,
  CapabilityReport,
  Envelope,
  EventDefinition,
  PersonRow,
  PersonsQuery,
  PersonsResult,
  ResultFor,
  SourceRef,
} from "@hostpog/contracts";

export interface HealthReport {
  ok: boolean;
  checkedAt: string;
  latencyMs: number | null;
  message: string;
  /** scopes we needed and could not confirm */
  missingScopes?: string[];
}

export interface SessionSummary {
  sessionId: string;
  distinctId: string | null;
  startTime: string;
  durationSeconds: number | null;
  /** authorized deep link to the original product (external sources only) */
  externalUrl?: string;
}

export interface QueryContext {
  signal?: AbortSignal;
  /** project timezone override (otherwise provider's own) */
  timezone?: string;
}

/**
 * Typed analytics provider. One instance is bound to exactly one source within
 * one HostPog project; tenant scoping happens before an instance is created.
 */
export interface AnalyticsProvider {
  readonly source: SourceRef;
  capabilities(): Promise<CapabilityReport>;
  health(ctx?: QueryContext): Promise<HealthReport>;
  listEventDefinitions(search?: string, ctx?: QueryContext): Promise<Envelope<EventDefinition[]>>;
  query<Q extends AnalyticsQuery>(q: Q, ctx?: QueryContext): Promise<Envelope<ResultFor<Q>>>;
  listPersons(q: PersonsQuery, ctx?: QueryContext): Promise<Envelope<PersonsResult>>;
  getPerson(id: string, ctx?: QueryContext): Promise<Envelope<PersonRow | null>>;
  listSessions(opts: { personId?: string; limit?: number }, ctx?: QueryContext): Promise<Envelope<SessionSummary[]>>;
}
