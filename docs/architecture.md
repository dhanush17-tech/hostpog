# Architecture

```
browser ──► apps/web (Next.js 16)
              ├─ marketing + docs (static)
              ├─ product UI (React 19, TanStack Query, ECharts)
              └─ /api/v1/* route handlers ── authz ── providers
                                                     ├─ PostHogProvider ──HTTPS──► us/eu.posthog.com (read-only HogQL)
                                                     └─ NativeProvider ──► ClickHouse (+ Postgres identity)
                                         └─ investigations ── @hostpog/ai ──HTTPS──► customer's model provider
SDKs (@hostpog/js, @hostpog/node) ──► apps/ingest (Fastify) ──► ClickHouse / Postgres
Postgres: users, sessions, workspaces, projects, sources, encrypted credentials, dashboards, investigations, audit
Redis: ingest rate limits + dedup claims (optional; in-memory fallback)
```

## Packages

| Package | Responsibility |
|---|---|
| `contracts` | Zod schemas: metric DSL, results, provenance envelope, ingest payloads, investigation report, roles |
| `analytics` | `AnalyticsProvider` interface, typed errors, range resolution, DSL→SQL compiler (HogQL / ClickHouse), result shaping, shared `SqlProvider` |
| `posthog` | Budgeted HTTP client, discovery + scope probes, OAuth (PKCE), cache, `PostHogProvider` |
| `native` | ClickHouse schema/migrations, ingest pipeline, identity resolution, `NativeProvider`, demo generator |
| `db` | Drizzle schema, migrations, AES-256-GCM secret envelope |
| `ai` | BYOK model adapters, SSRF-guarded fetch, redaction, tools, investigation runner, ticket/prompt rendering |
| `sdk-js`, `sdk-node` | Client SDKs |

## Decisions

**ADR-1 New application, posthog-foss as reference.** Importing the upstream monorepo (Django, Celery, Kafka, plugin
server) would make HostPog harder to self-host than PostHog itself. Cost: re-implementing analytics semantics;
mitigated by compiling to HogQL for connected sources so PostHog's own engine does the work.

**ADR-2 One compiler, two dialects.** HogQL is close to ClickHouse SQL. A single `SqlBuilder` emits either
`{p0}` placeholders (HogQL `values`) or `{p0:Type}` (ClickHouse params), with dialect-specific property access,
bucketing and an events source. Shaping (zero-fill, breakdown top-N, funnel math) is shared, so connect and native
modes report the same definitions.

**ADR-3 Route handlers for the control plane, Fastify for ingest.** Ingest has different scaling, CORS and abuse
characteristics and must not depend on the UI process.

**ADR-4 Partition native data by source.** `events.project_id` in ClickHouse holds the source id. Demo/native/imported
data cannot be summed accidentally and can be deleted per source with one mutation.

**ADR-5 Identity: Postgres authoritative, ClickHouse mirror resolved at read time.** Transactional merges with an
advisory lock per partition; versioned `person_distinct_ids` rows; queries join `argMax(person_id, version)`, so merges
apply retroactively without rewriting events. Trade-off: join cost on large datasets (materialised persons-on-events
is a later optimisation).

**ADR-6 Dedup.** Claim per (partition, uuid) for 24 h + `ReplacingMergeTree(received_at)` ordered by
`(project_id, toDate(timestamp), event, uuid)` + `FINAL` in queries. Retries with the same uuid/timestamp collapse.
Limitation: a retry that changes the event timestamp after the 24 h claim window would not collapse.

**ADR-7 Investigations in-process.** Bounded (16 steps, 14 tool calls, 4k output tokens/step, 180 s) and cancellable.
Moves to a worker queue in Gate E.

## Threat model (summary)

| Threat | Mitigation |
|---|---|
| Cross-tenant access | Every route resolves project → workspace membership server-side; 404 for non-members; provider instances bound to one source; native SQL always scoped by partition; caches keyed by workspace+source+credential |
| Credential theft from DB | AES-256-GCM with workspace-bound AAD; key outside DB; keys never returned to clients; hints only |
| SSRF via self-hosted PostHog / AI endpoints | Operator allowlists; https required; private ranges blocked with connect-time DNS check; redirects disabled; pagination limited to the configured host |
| SQL injection | No user/LLM SQL; values parameterised; property keys restricted alphabet; LIMITs and ClickHouse execution limits |
| Prompt injection via telemetry | Tool outputs labelled untrusted; agent has read-only tools only; no network/shell; citations validated |
| PII to model providers | Aggregates by default, property allowlist, email/IP masking, size bounds, opt-in raw mode per provider |
| XSS from event properties | Properties rendered as text (`JSON.stringify` in `<pre>`); CSP without third-party origins |
| CSRF | Same-origin check on state-changing routes; SameSite=Lax cookies |
| Brute force | Better Auth rate limits (10/min sign-in, 5/min sign-up) stored in Postgres |
| Abuse of public ingest keys | Write-only keys, per-key origins, per-key rate limit, size limits, revocation/rotation |

No compliance certifications are claimed.
