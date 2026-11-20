import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { TinybirdClient } from "./tinybird";

const g = globalThis as unknown as { __hostpogCh?: ClickHouseClient };

/** Where events live: self-hosted ClickHouse (default) or Tinybird (hosted, managed ClickHouse). */
export function eventsBackend(): "clickhouse" | "tinybird" {
  return process.env.HOSTPOG_EVENTS_BACKEND === "tinybird" ? "tinybird" : "clickhouse";
}

export function getClickHouse(): ClickHouseClient {
  if (!g.__hostpogCh && eventsBackend() === "tinybird") {
    const url = process.env.TINYBIRD_URL;
    const token = process.env.TINYBIRD_TOKEN;
    if (!url || !token) throw new Error("HOSTPOG_EVENTS_BACKEND=tinybird needs TINYBIRD_URL and TINYBIRD_TOKEN");
    // TinybirdClient implements the subset of the ClickHouse client HostPog uses (query/insert/command/ping).
    g.__hostpogCh = new TinybirdClient(url, token) as unknown as ClickHouseClient;
  }
  if (!g.__hostpogCh) {
    g.__hostpogCh = createClient({
      url: process.env.CLICKHOUSE_URL ?? "http://127.0.0.1:8123",
      username: process.env.CLICKHOUSE_USER ?? "default",
      password: process.env.CLICKHOUSE_PASSWORD ?? "",
      database: process.env.CLICKHOUSE_DB ?? "hostpog",
      request_timeout: 30_000,
      clickhouse_settings: {
        // defensive per-query limits; the app never runs model-written SQL
        max_execution_time: 20,
        max_result_rows: "60000",
        result_overflow_mode: "throw",
        readonly: "0",
      },
    });
  }
  return g.__hostpogCh;
}

export async function closeClickHouse() {
  await g.__hostpogCh?.close();
  g.__hostpogCh = undefined;
}

/** Versioned, idempotent schema. Append new entries; never edit shipped ones. */
export const CH_MIGRATIONS: { id: string; sql: string }[] = [
  {
    id: "0001_events",
    sql: `CREATE TABLE IF NOT EXISTS events (
      project_id String,
      source_id String,
      uuid UUID,
      event String,
      distinct_id String,
      timestamp DateTime64(3, 'UTC'),
      received_at DateTime64(3, 'UTC'),
      session_id String,
      properties String,
      props Map(String, String),
      sdk String,
      import_job_id String DEFAULT ''
    ) ENGINE = ReplacingMergeTree(received_at)
    PARTITION BY toYYYYMM(timestamp)
    ORDER BY (project_id, toDate(timestamp), event, uuid)`,
  },
  {
    id: "0002_person_distinct_ids",
    sql: `CREATE TABLE IF NOT EXISTS person_distinct_ids (
      project_id String,
      distinct_id String,
      person_id String,
      version UInt64
    ) ENGINE = ReplacingMergeTree(version)
    ORDER BY (project_id, distinct_id)`,
  },
  {
    id: "0003_person_props",
    sql: `CREATE TABLE IF NOT EXISTS person_props (
      project_id String,
      person_id String,
      props Map(String, String),
      version UInt64
    ) ENGINE = ReplacingMergeTree(version)
    ORDER BY (project_id, person_id)`,
  },
  {
    id: "0004_migrations_table",
    sql: `CREATE TABLE IF NOT EXISTS _hostpog_migrations (id String, applied_at DateTime DEFAULT now()) ENGINE = MergeTree ORDER BY id`,
  },
  {
    id: "0005_logs",
    sql: `CREATE TABLE IF NOT EXISTS logs (
      project_id String,
      source_id String,
      timestamp DateTime64(3, 'UTC'),
      received_at DateTime64(3, 'UTC'),
      level LowCardinality(String),
      service LowCardinality(String),
      message String,
      attributes Map(String, String),
      trace_id String,
      distinct_id String
    ) ENGINE = MergeTree
    PARTITION BY toYYYYMM(timestamp)
    ORDER BY (project_id, timestamp)
    TTL toDateTime(timestamp) + INTERVAL 30 DAY`,
  },
];

export async function migrateClickHouse(client = getClickHouse()): Promise<string[]> {
  // On Tinybird the schema ships with `tinybird deploy` (lib/tinybird.ts).
  if (eventsBackend() === "tinybird") return [];
  const db = process.env.CLICKHOUSE_DB ?? "hostpog";
  const admin = createClient({
    url: process.env.CLICKHOUSE_URL ?? "http://127.0.0.1:8123",
    username: process.env.CLICKHOUSE_USER ?? "default",
    password: process.env.CLICKHOUSE_PASSWORD ?? "",
  });
  await admin.command({ query: `CREATE DATABASE IF NOT EXISTS ${db.replace(/[^a-zA-Z0-9_]/g, "")}` });
  await admin.close();
  const applied: string[] = [];
  for (const m of CH_MIGRATIONS) {
    await client.command({ query: m.sql });
    applied.push(m.id);
  }
  await client.insert({
    table: "_hostpog_migrations",
    values: applied.map((id) => ({ id })),
    format: "JSONEachRow",
  });
  return applied;
}
