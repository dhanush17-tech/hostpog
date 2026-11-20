# HostPog: what's done, what's left, what's next

Status as of 2026-11-19. **Deployed:** https://hostpog.vercel.app (see `docs/deploy.md`): Vercel web, Railway Postgres and ingest, Tinybird events.

## Done

**Platform**
- Landing (light only), app shell with ⌘K, onboarding, BYOK providers, investigations, migration from PostHog.
- Hosted mode: Tinybird backend and the ingest job worker for imports and demo seeding.
- `RowMenu` action pattern app-wide, plus `docs/product-design-guide.md`.

**This round**
- **Ingest load test.** Returning visitors went from 651 to 4,919 events/s; all-new visitors from 421 to 2,209 (one 2-vCPU box). Details in `docs/loadtest.md`, script in `scripts/loadtest/ingest.mjs`.
- **One-command self-host.** `./hostpog up | status | logs | backup | update | down` uses `deploy/selfhost.compose.yml` and `infra/hostpog.Dockerfile`. First boot was simulated natively; Docker itself is untested.
- **AI assistant.**
  - ⌘J or "Ask AI" in the header.
  - Answers questions from the data, with inline charts.
  - Creates flags, experiments, surveys and workflows. They always start off, so you review them before they go live.
  - Uses the workspace's AI provider and token budget.
- **Feature flags.**
  - Rollout %, person-property conditions, variants and payloads.
  - Bucketing is PostHog-identical (verified against `@posthog/core`).
  - Served to posthog-js at `/ph/flags` and to the HostPog SDK at `/v1/flags`. While PostHog still runs in parallel, its flags are merged in.
- **Experiments.** Funnel from `$feature_flag_called` to the goal event, Bayesian chance-to-win, Wilson 95% intervals, launch/stop/ship.
- **Surveys.** Rendered by posthog-js's own widget (`/ph/api/surveys`, remote config, the `/static` bundle). Results come from `survey sent` events.
- **LLM analytics.** Built on `$ai_generation` events: cost, tokens, p95 latency, errors, by model and per generation. Trends gained sum/avg/p95 of a property.
- **Logs.** OTLP/HTTP JSON or plain JSON, via `/v1/logs` or posthog-js `/ph/i/v1/logs`. Search, level and service filters, histogram, links to users, 30-day TTL.
- **Workflows.** Event plus property filters → Slack or webhook. Delivery runs in the ingest worker with an SSRF guard and retries (30s, 2m, 10m).
- **Integration across the app.**
  - Nav groups (Product analytics, Ship, Data).
  - "Live in this project" panel on Overview.
  - ⌘K actions: Ask AI, New flag, New survey.
  - Demo data includes AI generations and logs.
  - Landing, `/oss` roadmap, PostHog docs and README updated.
- **Tests.** Unit and integration: db 6, analytics 11, posthog 18, native 25, ai 7, sdk-js 7, ingest 20. Playwright: 13, in both job modes.

## Left / known gaps

1. **Production needs a redeploy** for this round:
   - Railway ingest. Postgres migration `0002_products` runs on start.
   - `tinybird deploy` for the new `logs` data source.
   - Vercel.
2. **`./hostpog up` has not been run with real Docker.** Test it on a Mac with Docker Desktop.
3. **Experiments need real traffic to show results.** The demo dataset has no `$feature_flag_called` events, so demo experiments show "not launched". A seeded demo experiment would help the launch video.
4. **The assistant doesn't stream.** It answers in one response (up to about 30s with tool calls). Streaming tokens would feel faster.
5. **Workflows:** event triggers only, delivered at least once. No email, delays or multi-step flows.
6. **Logs:** no live tail (the 1h range auto-refreshes every 15s), no saved searches, no alerting on log volume.
7. **Not built:** session replay playback, error tracking, cohorts, MCP server.
8. **Still open from the last round:**
   - Investigation cancel on Vercel.
   - Publish `@hostpog/js`.
   - Audit the older pages against the guide.
   - Clean up the report's limitations copy.
   - `docs/design-system.md` is outdated.
9. **Housekeeping:**
   - Commit on a branch.
   - Delete `_to_delete/`.
   - Rotate the Tinybird token that was pasted in chat.
   - Back up `HOSTPOG_MASTER_KEY`.
   - Vercel Hobby is non-commercial only: move to Pro before charging anyone.

## Next, in order

1. Redeploy (item 1) and run `node apps/web/e2e/prod-smoke.mjs`.
2. Run `./hostpog up` on a clean machine.
3. Seed a demo experiment with exposures and conversions, then record the launch video (PostHog → HostPog in one line, assistant creating a flag, LLM analytics, logs).
4. Stream assistant replies.
5. Error tracking (`$exception` events plus grouping); it's the most requested missing PostHog feature.
6. Session replay playback.
