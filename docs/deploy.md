# Hosted deployment (Vercel + Railway + Tinybird)

Live since 2026-11-19: **https://hostpog.vercel.app**

```
 browser ──► Vercel: apps/web (Next.js, region sfo1)
                │  Postgres over Railway TCP proxy · Tinybird HTTP · ingest /internal/* with HOSTPOG_INTERNAL_TOKEN
                ▼
 SDKs ────► Railway: ingest (apps/ingest, infra/ingest.Dockerfile)
                │  /v1/capture, /v1/batch, /ph/* (PostHog-compatible)
                │  job worker: PostHog history imports, sample data
                │  runs Postgres migrations on start
                ▼
            Railway: Postgres (private network)      Tinybird: events, person_distinct_ids, person_props
```

| Piece | Where | Notes |
|---|---|---|
| Web app | Vercel project `hostpog` (scope `dhanush17techs-projects`, Hobby), root dir `apps/web`, `apps/web/vercel.json` pins `sfo1` | Hobby is non-commercial only: move to Pro before charging users |
| Ingest + worker | Railway project `hostpog`, service `ingest` (`RAILWAY_DOCKERFILE_PATH=infra/ingest.Dockerfile`) | https://ingest-production-5c3ec2fa.up.railway.app |
| Postgres | Railway project `hostpog`, service `Postgres`, TCP proxy for Vercel | Egress through the proxy is billed |
| Events | Tinybird workspace (europe-west2), schema in `lib/tinybird.ts` | Deploy schema changes with `tinybird deploy` |

## Why the worker exists

Vercel functions stop after the response and at 300s. Ingestion does several Postgres round trips per event (identity
resolution), so sample data and PostHog history imports timed out from Vercel. With `HOSTPOG_JOB_RUNNER=worker`:

- the web app inserts the import job as `queued`; the ingest worker claims it with a Postgres advisory lock, runs it
  next to Postgres, checkpoints every page and resumes after restarts; cancel sets status `cancelled` in the DB;
- sample data is seeded through `POST /internal/demo` on the ingest server.

Self-hosting on a long-running server keeps the default `HOSTPOG_JOB_RUNNER=inline`.

## Environment

Both services: `HOSTPOG_MASTER_KEY` (+ `_VERSION`), `BETTER_AUTH_SECRET`, `HOSTPOG_EVENTS_BACKEND=tinybird`,
`TINYBIRD_URL`, `TINYBIRD_TOKEN`, `HOSTPOG_JOB_RUNNER=worker`, `HOSTPOG_INTERNAL_TOKEN`.

- Vercel only: `DATABASE_URL` (public TCP-proxy URL), `BETTER_AUTH_URL` and `HOSTPOG_PUBLIC_URL` (=https://hostpog.vercel.app),
  `HOSTPOG_INGEST_PUBLIC_URL` and `NEXT_PUBLIC_HOSTPOG_INGEST_URL` (= ingest URL).
- Railway ingest only: `DATABASE_URL=${{Postgres.DATABASE_URL}}` (private), `INGEST_PORT=8080`, `RAILWAY_DOCKERFILE_PATH`.

`HOSTPOG_MASTER_KEY` encrypts every stored PostHog and AI key. Keep a copy somewhere safe; losing it makes them unreadable.

## Redeploy

```bash
railway up --service ingest --ci                       # from the repo root (linked to project hostpog)
vercel deploy --prod --scope dhanush17techs-projects   # from the repo root (linked to project hostpog)
```

## Tests

- `pnpm test:e2e`: full local suite (fixtures for PostHog and the AI model). Passes in both job modes; set
  `HOSTPOG_JOB_RUNNER=worker HOSTPOG_INTERNAL_TOKEN=x HOSTPOG_INGEST_PUBLIC_URL=http://localhost:3001` for worker mode.
- `node apps/web/e2e/prod-smoke.mjs [webUrl] [ingestUrl]`: production smoke test (sign up, sample data, charts,
  funnel, SDK event through ingest, cleanup). Creates a throwaway `@example.test` account each run.

## Known limits

- Sample data takes about a minute (Railway US West → Tinybird London inserts).
- History imports through PostHog's API are capped by `API_IMPORT_MAX_EVENTS`; larger histories need a batch-export
  file upload, which still runs inside the web request (fine for small files, slow for large ones on Vercel).
- Tinybird free plan: 1 query thread, 10s query limit.
