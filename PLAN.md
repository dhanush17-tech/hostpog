# HostPog — plan, decisions and checklist

Status as of 2026-11-18. The checklist is kept truthful: **done** means implemented *and* tested as stated;
"fixture-tested" means verified against documented API shapes, not a live PostHog account.

## Gates

| Gate | Scope | Status |
|---|---|---|
| A | Repo audit, DevLabs theme extraction, monorepo, local infra, migrations, auth, tenancy | **done** |
| B | PostHog connect (API key + OAuth), discovery, scope probes, trends, funnels, retention, users, web, overview | **done — live-verified 2026-11-18** against a real US Cloud project (API-key path; OAuth still untested live) |
| C | BYOK providers, SSRF guard, budgets, bounded agent tools, evidence-backed investigations, ticket/prompt export | **done** (fake-provider contract tested; no real-provider run yet) |
| D | Native SDKs → ingest → ClickHouse → query, identity merges, live events, dashboards, parity tests | **done** |
| E | Historical import + reconciliation, native replay, error tracking, LLM traces | not started |
| F | Alerts, MCP server, flags, experiments, heatmaps, surveys, Stripe | not started |
| G | Production hardening, benchmarks, full design QA | partial (see below) |

## Checklist

### Foundation
- [x] pnpm monorepo: `apps/web`, `apps/ingest`, `packages/{contracts,analytics,db,native,posthog,ai,sdk-js,sdk-node}`
- [x] Postgres schema + Drizzle migration (`packages/db/migrations/0000_init.sql`)
- [x] ClickHouse schema, versioned idempotent migrations (`packages/native/src/clickhouse.ts`)
- [x] Docker Compose for Postgres/ClickHouse/Redis/Mailpit (`infra/docker-compose.yml`) — tested 2026-11-18: services healthy, migrations + integration tests pass; host ports configurable via .env (Postgres defaults to 5433)
- [x] Better Auth email+password, rate-limited sign-in/up, secure cookies on https, `SameSite=Lax`
- [x] Workspaces, projects, roles (owner/admin/member/viewer); centralised authz (`apps/web/src/server/authz.ts`)
- [x] CSRF: same-origin check on every cookie-authenticated state-changing route
- [x] Audit log for connections, credential changes, deletions, investigations, membership
- [ ] Email-link login / SMTP invites (Mailpit service is provisioned; flows not built)
- [ ] OAuth sign-in to HostPog itself (optional in spec)

### PostHog connect (Gate B)
- [x] Documented hosts only; self-hosted instances require operator allowlist (SSRF)
- [x] Personal API key path: discovery (`/api/users/@me/`, `/api/organizations/:id/projects/`), scope probes, encrypted storage
- [x] OAuth: CIMD client document, PKCE S256, single-use state, refresh, revoke on disconnect — **untested live**: requires public HTTPS
- [x] Client: budgets (80% of documented limits), backoff + jitter, Retry-After, deadlines, cancellation, typed 401/403/404/429/5xx, same-host pagination only
- [x] Cache keyed by workspace/source/credential/fingerprint with coalescing; invalidated on disconnect/rotation
- [x] Metric DSL → HogQL with `values` placeholders; `windowFunnel`, `toDateTime` semantics checked against posthog-foss source
- [x] First bounded query after connect; time-to-first-result measured and shown
- [x] Sessions list with authorised deep links to PostHog recordings (no embedded playback)
- [x] Disconnect deletes credential; delete-data is a separate action (not applicable to PostHog)
- [x] Live verification against a real project: `pnpm posthog:smoke` and `apps/web/e2e/live-posthog.mjs` (20/20 steps) passed on US Cloud, 2026-11-18
- [ ] Read-only flags/experiments/surveys views

### Analytics UI (P0)
- [x] Overview: unique users, new users, events with previous-period deltas; activity chart; configurable funnel; top events; recent investigations; source status
- [x] Events explorer: filters, keyset pagination, JSON drawer, live refresh
- [x] Trends: up to 4 series, total/unique/per-user, interval, breakdown, compare, bar/line, save to dashboard
- [x] Funnels: ordered steps, window, breakdown, drop-off, median time (approx.), reached/dropped person drill-down
- [x] Retention: exact day/week cohorts, incomplete periods blank
- [x] Users: search, identified/anonymous filter, profile with timeline and sessions
- [x] Web: visitors, pageviews, sessions, bounce (defined), top/entry pages, referrers, UTM, browser, device
- [x] Dashboards: create/rename/delete, add insights, reorder, remove, global range/source
- [x] Provenance footer on every insight: source, window, tz, cached/data-as-of, warnings, exact query
- [x] Command palette, light/dark/system, responsive at 375/1440 (checked by screenshot test)

### AI (Gate C)
- [x] Providers: OpenAI, Anthropic, Gemini, OpenRouter, OpenAI-compatible/local via Vercel AI SDK v7
- [x] Model discovery from provider APIs (no hardcoded model lists); explicit 1-request test
- [x] Keys encrypted, never returned; SSRF guard with connect-time DNS check; operator allowlist for private hosts
- [x] Monthly token budget per provider; usage tracking; step/tool-call/time limits; cancel
- [x] Read-only typed tools over the DSL; no SQL, no shell, project scope fixed server-side
- [x] Redaction: aggregates by default, allowlisted event props, masked emails/IPs, bounded output
- [x] Structured report, citations validated against real evidence (fabricated IDs stripped, confidence downgraded)
- [x] Engineering ticket + Claude Code/Codex prompt export
- [ ] Durable worker queue (runs are in-process today; restart marks them failed)
- [ ] GitHub App correlation (optional)

### Native (Gate D)
- [x] Ingest: write-only `hp_pk_` keys, per-key origins, rate limit (Redis-backed when configured), 1 MB/500 events/64 KB limits, ack after durable write, 503 → retry
- [x] Dedup: Redis/memory claim per (partition, uuid) released on failure + ReplacingMergeTree + `FINAL`
- [x] Identity: Postgres-authoritative merges mirrored to ClickHouse; anonymous→identified merge; never merge two identified persons; persons dated by first event
- [x] Server-side redaction of secret-looking properties and URL query params
- [x] `@hostpog/js`: batching, persisted bounded queue, beacon flush, backoff, opt-in/out, SPA pageviews, opt-in click autocapture, URL sanitisation, sampling
- [x] `@hostpog/node`: capture/identify/captureException/flush/shutdown with retry
- [x] Demo dataset: deterministic, labelled, planted Safari regression, separate partition
- [ ] Python SDK, OTLP traces, replay chunks, PostHog-compatible ingest endpoint

### Hardening (Gate G, partial)
- [x] Security headers + CSP (no third-party origins), `poweredByHeader` off, HSTS in production
- [x] Threat model and limitations documented (`docs/architecture.md`)
- [x] GitHub Actions CI definition (`.github/workflows/ci.yml`) — **not executed** (no remote yet)
- [ ] App container images (web/ingest) and a full-stack Compose profile
- [ ] Load/benchmark tests; observability metrics endpoint (in-process counters only today)

## Architecture decisions (summary — details in docs/architecture.md)

1. **Focused new app, not a PostHog fork.** posthog-foss is a reference only (docs/upstream-audit.md).
2. **One compiler, two dialects.** The metric DSL compiles to HogQL (PostHog) or ClickHouse SQL (native); result shaping is shared, so both modes have identical semantics where possible.
3. **Control-plane API inside Next.js route handlers; ingestion as a separate Fastify service.** Fewer moving parts; ingestion scales independently.
4. **Native data partitioned by source id**, so native, demo and imported data never mix and can be deleted per source.
5. **Postgres is authoritative for identity**, ClickHouse holds a versioned mirror resolved at query time (retroactive merges).
6. **Sources are never summed.** Every query resolves exactly one source.
7. **License: MIT** (working decision; confirm before publication).

## Known bugs / limitations

- Identity mirror race: two concurrent ingest processes can briefly write mappings out of order (version = wall-clock µs). Self-heals on the next event for that distinct id.
- Unique-user values per bucket cannot be summed; the UI warns.
- Funnel median time-to-convert uses first occurrences and is labelled approximate.
- PostHog week buckets follow ClickHouse `toStartOfWeek` mode 0 (Sunday), which may differ from a PostHog project's week-start setting.
- Investigations run in the web process; restarts orphan running investigations (shown as failed).
- In-process request budgets/caches are per web instance; multi-instance deployments need the Redis-backed versions (roadmap).

## Next session — resume here

1. Build the "Move off PostHog" flow (posthog-js `api_host` switch with forwarding, batch-export import, reconciliation, cutover checklist with product-gap check).
2. Rotate the PostHog key that was shared in chat.
3. Gate E: batch-export import with reconciliation; errors (`$exception` grouping already fingerprinted by the Node SDK).
4. Worker queue (BullMQ) for investigations/imports; Redis-backed budgets.
5. Container images + full-stack Compose; run CI on GitHub once a repo exists.
