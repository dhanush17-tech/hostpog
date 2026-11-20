# Ingest load test

```bash
node scripts/loadtest/ingest.mjs --url http://localhost:3001 --key hp_pk_… --seconds 30 --concurrency 16 --batch 50 [--users 5000] [--identify-rate 0.02]
```

Sends posthog-like events (`$pageview`, `$autocapture`, custom events, 2% `$identify` with `$set`) to `/v1/batch`
and prints events/sec and request latency percentiles. `--users` sets how many distinct visitors exist; a very large
number means nearly every event is a brand-new visitor (worst case for identity resolution).

## Results (2026-11-19, one 2-vCPU VM running Postgres, ClickHouse and ingest together)

| Scenario | Before | After |
|---|---|---|
| Returning visitors (5k users, 2% identify) | 651 events/s, p50 1.1s per 50-event batch | **4,919 events/s**, p50 144ms, p95 421ms |
| All new visitors (1M users) | 421 events/s, p50 1.9s | **2,209 events/s**, p50 330ms, p95 677ms |

0 failed events in every run.

## What changed

Every event used to run its own identity transaction, and that transaction takes a per-project Postgres advisory
lock, so all ingestion for a project was serialised. It also re-wrote a `person_distinct_ids` mirror row per event.

Now (`packages/native/src/ingest.ts`):

1. A per-process cache remembers distinct ids that already have a person (15 min TTL, 500k entries).
2. Unknown ids of plain events are looked up in one query per batch.
3. Genuinely new anonymous visitors get their persons created in one locked transaction per batch
   (`createAnonymousPersons`), safe against concurrent ingest instances.
4. Only `$identify`, `$create_alias` and events with `$set` (or new `$set_once` keys) take the per-event path.

## Rough capacity

At ~2,000–5,000 events/s per small instance, one ingest server handles roughly 170–430M events/day of steady
traffic, if the event store keeps up. On the hosted setup the limits are elsewhere: Tinybird's free plan and the
$5 Railway plan. Self-hosting on your own ClickHouse removes those. Add ingest instances behind a load balancer to
scale further (the cache and the locks are safe across instances).
