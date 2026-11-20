# PostHog API contract used by HostPog

Recorded 2026-11-18 from official documentation and the MIT `posthog-foss` source at commit
`86eaa161aaa0e1d3233971a0ef85e5cb4ad4138d` (2026-11-18). Nothing here is guessed; gaps are marked.

Sources:
- https://posthog.com/docs/api
- https://posthog.com/docs/api/scopes
- https://posthog.com/docs/api/queries
- https://posthog.com/docs/api/projects
- https://posthog.com/docs/api/oauth
- https://posthog.com/docs/data-pipelines/batch-exports
- Live: `https://us.posthog.com/.well-known/oauth-authorization-server` (fetched unauthenticated 2026-11-18)

## Hosts

| | Private API | Public capture (not used) |
|---|---|---|
| US | `https://us.posthog.com` | `https://us.i.posthog.com` |
| EU | `https://eu.posthog.com` | `https://eu.i.posthog.com` |
| Self-hosted | instance origin (operator-approved in HostPog) | — |

## Authentication

- `Authorization: Bearer <token>` (query docs example). Personal API keys are prefixed `phx_`; OAuth access tokens `pha_`, refresh tokens `phr_`.
- Requests via OAuth do not count against personal-API-key rate limits (docs).
- Missing scope → `403` with `detail: "API key missing required scope '<scope>'"` (posthog/permissions.py, posthog/exceptions.py). HostPog parses the scope name from this message.

## Endpoints used

| Method & path | Scope | Notes |
|---|---|---|
| `GET /api/users/@me/` | `user:read` | `organization`, `organizations[]`; not documented on the projects page — used for discovery only, failure tolerated |
| `GET /api/organizations/:organization_id/projects/` | `project:read` | `limit`, `offset`; response `count,next,previous,results[]` with `id, uuid, organization, project_id, api_token, name, timezone, …` (HostPog never stores `api_token`) |
| `POST /api/projects/:project_id/query/` | `query:read` | body `{ query: { kind: "HogQLQuery", query, values }, name }`; response `results, columns, types, hasMore, limit, is_cached, last_refresh, …` |
| `GET /api/projects/:project_id/event_definitions/` | `event_definition:read` | registered on `projects_router` with `project_id` (rest_router.py) |
| `GET /api/projects/:project_id/session_recordings/` | `session_recording:read` | probe only (`limit=1`) |
| `GET /api/projects/:project_id/insights/` | `insight:read` | probe only |

`HogQLQuery.values` (dict) exists in `posthog/schema.py` and fills `{name}` placeholders; HostPog passes every
user-controlled value this way.

### HogQL behaviour relied on (checked in posthog-foss)

- `toDateTime(String)` maps to `parseDateTime64BestEffortOrNull` and is timezone-aware (`posthog/hogql/functions/clickhouse/conversions.py`). HostPog passes full ISO-8601 strings with `Z`.
- `windowFunnel` is available (aggregations.py) and, like ClickHouse, needs `DateTime` not `DateTime64`; HostPog wraps timestamps in `toDateTime(...)` (found by the native integration test).
- `argMinIf`, `quantileIf`, `positionCaseInsensitive`, `toFloat64OrNull` (→ `accurateCastOrNull`), `greatest`, `dateDiff`, `toStartOfWeek` exist.
- Tables: `events` (`uuid, event, distinct_id, person_id, timestamp, properties`, `person.properties`), `persons` (`id, created_at, is_identified, properties`), `person_distinct_ids`.

## Limits (documented)

| Category | Limit |
|---|---|
| Query endpoint | 2,400/hour, 240/minute; plus an hourly read budget for personal keys |
| Query execution | 10 s max; 3 concurrent queries per project; queued up to 30 s |
| Rows | 100 default; up to 50k with explicit `LIMIT`; `OFFSET` returns 400 for personal keys → keyset pagination |
| Analytics endpoints (insights, persons, recordings) | 240/minute, 1,200/hour |
| Other CRUD | 480/minute, 4,800/hour |

HostPog budgets to `HOSTPOG_POSTHOG_BUDGET_FRACTION` (default 0.8) of these and honours `Retry-After`.

## OAuth (live metadata, US)

`authorization_endpoint /oauth/authorize/`, `token_endpoint /oauth/token/`, `revocation_endpoint /oauth/revoke/`,
`introspection_endpoint /oauth/introspect/`, `registration_endpoint /oauth/register/`, `jwks_uri`, plus a
`scopes_supported` list. Docs: clients use a Client ID Metadata Document at an HTTPS URL; required fields
`client_id, client_name, redirect_uris`; `token_endpoint_auth_method` `none` (default) or `private_key_jwt`;
PostHog-specific `com.posthog` scopes / optional scopes; redirect URIs must match exactly; loopback `http` allowed.
Not documented: token lifetimes, refresh rotation, project selection params. HostPog reads endpoints from metadata
and does not assume them.

**Gap:** whether `code_challenge_methods_supported` is present in metadata was not confirmed; HostPog always sends S256
and rejects metadata that advertises methods without S256.

## Batch exports (for Gate E)

Destinations: S3 / S3-compatible, Azure Blob, BigQuery, Databricks, Snowflake, Postgres, Redshift. `uuid` usable
for de-duplication; `person_id`/`person_properties` are as-of ingestion; runs are assigned by ingestion time;
backfills can create duplicates. File format/compression/key naming are per destination — **to be recorded before
building the importer.**

## Verification status

| Item | Status |
|---|---|
| Request/response shapes | fixture-tested (`packages/posthog/test`, `apps/web/e2e`) |
| HogQL text against a live project | **not yet** — the build environment could not reach posthog.com |
| Live smoke | `POSTHOG_SMOKE_API_KEY=… pnpm posthog:smoke` (read-only) |
