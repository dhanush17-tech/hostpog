/**
 * Tinybird definitions for HostPog's event store.
 *
 * These mirror the ClickHouse tables in packages/native/src/clickhouse.ts (CH_MIGRATIONS) column-for-column,
 * so the same analytics SQL runs on either backend. Change both together.
 *
 *   tinybird build    → push to a dev branch
 *   tinybird deploy   → push to main (what the app reads and writes)
 */
import { defineDatasource, engine, t, Tinybird, type InferRow } from "@tinybirdco/sdk";

export const events = defineDatasource("events", {
  description: "HostPog events (one row per captured event)",
  schema: {
    project_id: t.string(),
    source_id: t.string(),
    uuid: t.uuid(),
    event: t.string(),
    distinct_id: t.string(),
    timestamp: t.dateTime64(3, "UTC"),
    received_at: t.dateTime64(3, "UTC"),
    session_id: t.string(),
    properties: t.string(),
    props: t.map(t.string(), t.string()),
    sdk: t.string(),
    import_job_id: t.string(),
  },
  // Same dedup rule as ClickHouse: one row per (project, time, event, uuid); latest received_at wins.
  engine: engine.replacingMergeTree({
    sortingKey: ["project_id", "timestamp", "event", "uuid"],
    partitionKey: "toYYYYMM(timestamp)",
    ver: "received_at",
  }),
});

export const personDistinctIds = defineDatasource("person_distinct_ids", {
  description: "distinct_id → person_id mapping",
  schema: {
    project_id: t.string(),
    distinct_id: t.string(),
    person_id: t.string(),
    version: t.uint64(),
  },
  engine: engine.replacingMergeTree({ sortingKey: ["project_id", "distinct_id"], ver: "version" }),
});

export const personProps = defineDatasource("person_props", {
  description: "Latest person properties",
  schema: {
    project_id: t.string(),
    person_id: t.string(),
    props: t.map(t.string(), t.string()),
    version: t.uint64(),
  },
  engine: engine.replacingMergeTree({ sortingKey: ["project_id", "person_id"], ver: "version" }),
});

export const logs = defineDatasource("logs", {
  description: "Application logs (OTLP / posthog-js logger), kept 30 days",
  schema: {
    project_id: t.string(),
    source_id: t.string(),
    timestamp: t.dateTime64(3, "UTC"),
    received_at: t.dateTime64(3, "UTC"),
    level: t.string().lowCardinality(),
    service: t.string().lowCardinality(),
    message: t.string(),
    attributes: t.map(t.string(), t.string()),
    trace_id: t.string(),
    distinct_id: t.string(),
  },
  engine: engine.mergeTree({
    sortingKey: ["project_id", "timestamp"],
    partitionKey: "toYYYYMM(timestamp)",
    ttl: "toDateTime(timestamp) + INTERVAL 30 DAY",
  }),
});

export type EventRow = InferRow<typeof events>;

export const tinybird = new Tinybird({
  datasources: { events, personDistinctIds, personProps, logs },
  pipes: {},
});
