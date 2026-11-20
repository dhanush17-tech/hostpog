/**
 * Integration tests against REAL ClickHouse + Postgres (no mocks).
 * Uses a small fixed fixture whose expected counts are computed by hand below.
 * Requires DATABASE_URL and ClickHouse env (see .env.example).
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb, nativePersonDistinctIds, projects, sources, workspaces, type Db } from "@hostpog/db";
import { eq } from "drizzle-orm";
import { closeClickHouse, getClickHouse, migrateClickHouse } from "../src/clickhouse";
import { ingestBatch, KnownIdCache, MemoryDedupStore } from "../src/ingest";
import { NativeProvider } from "../src/provider";

let db: Db;
let projectId: string;
let otherProjectId: string;
let sourceId: string;
const dedup = new MemoryDedupStore();
const day = (d: number, h = 12, m = 0) => new Date(Date.UTC(2026, 10, d, h, m)).toISOString();

/*
 * Fixture (all in Nov 2026, UTC):
 *  anon-a: pageview(10) -> signed_up(10) -> $identify as alice(10) -> onboarding_started(10, +1h) -> profile_completed(11)
 *  anon-b: pageview(10) -> signed_up(10, Safari) -> $identify bob -> onboarding_started(10)            (drops)
 *  anon-c: pageview(11) only                                                                           (bounce)
 *  alice also: pageview(12) on a new device anon-d, later identify(alice, anon-d) -> must merge into alice
 *  out-of-order: carol does profile_completed(12, 09:00) BEFORE onboarding_started(12, 10:00) -> not a conversion
 *  retried duplicate: alice's signed_up sent twice with the same uuid
 */
function fixture() {
  const sess = randomUUID();
  const ev = (event: string, distinct: string, ts: string, props: Record<string, unknown> = {}) => ({
    uuid: randomUUID(),
    event,
    distinct_id: distinct,
    timestamp: ts,
    properties: { $session_id: sess, $browser: "Chrome", ...props },
  });
  const signedUpAlice = ev("signed_up", "anon-a", day(10, 12, 1));
  return {
    events: [
      ev("$pageview", "anon-a", day(10, 12, 0), { $pathname: "/", $session_id: "s-a" }),
      signedUpAlice,
      { ...signedUpAlice }, // retry duplicate
      ev("$identify", "alice", day(10, 12, 2), { $anon_distinct_id: "anon-a", $set: { email: "alice@example.test" } }),
      ev("onboarding_started", "alice", day(10, 13, 2)),
      ev("profile_completed", "alice", day(11, 9, 0)),
      ev("$pageview", "anon-b", day(10, 14, 0), { $pathname: "/", $session_id: "s-b" }),
      ev("$pageview", "anon-b", day(10, 14, 1), { $pathname: "/signup", $session_id: "s-b" }),
      ev("signed_up", "anon-b", day(10, 14, 2), { $browser: "Safari" }),
      ev("$identify", "bob", day(10, 14, 3), { $anon_distinct_id: "anon-b" }),
      ev("onboarding_started", "bob", day(10, 14, 4)),
      ev("$pageview", "anon-c", day(11, 8, 0), { $pathname: "/pricing", $session_id: "s-c" }),
      ev("$pageview", "anon-d", day(12, 8, 0), { $pathname: "/", $session_id: "s-d" }),
      ev("$identify", "alice", day(12, 8, 5), { $anon_distinct_id: "anon-d" }),
      ev("signed_up", "carol", day(12, 8, 0)),
      ev("profile_completed", "carol", day(12, 9, 0)),
      ev("onboarding_started", "carol", day(12, 10, 0)),
      ev("password_set", "carol", day(12, 10, 1), { password: "hunter2", note: "ok" }),
    ],
  };
}

beforeAll(async () => {
  db = getDb();
  await migrateClickHouse();
  const [w] = await db.insert(workspaces).values({ name: "native-it" }).returning();
  const [p] = await db.insert(projects).values({ workspaceId: w!.id, name: "it", timezone: "UTC" }).returning();
  const [p2] = await db.insert(projects).values({ workspaceId: w!.id, name: "other", timezone: "UTC" }).returning();
  const [s] = await db.insert(sources).values({ projectId: p!.id, kind: "native", label: "native" }).returning();
  const [s2] = await db.insert(sources).values({ projectId: p2!.id, kind: "native", label: "other" }).returning();
  projectId = s!.id; // storage partition = source id
  otherProjectId = s2!.id;
  sourceId = s!.id;
  const out = await ingestBatch(fixture().events, {
    db,
    ch: getClickHouse(),
    dedup,
    partitionId: projectId,
    sourceId,
    now: new Date("2026-11-13T00:00:00Z"),
  });
  expect(out.rejected).toEqual([]);
  expect(out.duplicates).toBe(1);
  // a different tenant's event with the same distinct id must never be visible
  await ingestBatch([{ uuid: randomUUID(), event: "signed_up", distinct_id: "alice", timestamp: day(10), properties: {} }], {
    db,
    ch: getClickHouse(),
    dedup,
    partitionId: otherProjectId,
    sourceId: otherProjectId,
    now: new Date("2026-11-13T00:00:00Z"),
  });
}, 60_000);

afterAll(async () => {
  await closeClickHouse();
});

const provider = () => new NativeProvider({ db, ch: getClickHouse(), partitionId: projectId, sourceId, timezone: "UTC" });
const range = { from: "2026-11-10", to: "2026-11-13" };

describe("native analytics on a fixed dataset", () => {
  it("dedupes retried events (signed_up counted once per send)", async () => {
    const env = await provider().query({ kind: "trend", series: [{ event: "signed_up", math: "total", filters: [] }], interval: "day", dateRange: range, compare: false, filters: [] });
    expect(env.result.series[0]!.points).toEqual([
      { t: "2026-11-10", v: 2 },
      { t: "2026-11-11", v: 0 },
      { t: "2026-11-12", v: 1 },
    ]);
  });

  it("resolves identity merges retroactively for unique users", async () => {
    // pageviews by anon-a (alice), anon-b (bob), anon-c, anon-d (alice) => 3 unique persons
    const env = await provider().query({ kind: "trend", series: [{ event: "$pageview", math: "unique_users", filters: [] }], interval: "month", dateRange: range, compare: false, filters: [] });
    expect(env.result.series[0]!.points[0]!.v).toBe(3);
  });

  it("computes an ordered funnel with unique-person denominators", async () => {
    const env = await provider().query({
      kind: "funnel",
      steps: [
        { event: "signed_up", filters: [] },
        { event: "onboarding_started", filters: [] },
        { event: "profile_completed", filters: [] },
      ],
      windowSeconds: 7 * 86400,
      dateRange: range,
      filters: [],
    });
    // alice: 3 steps; bob: 2 steps; carol: profile before onboarding => 2 steps
    expect(env.result.steps.map((s) => s.count)).toEqual([3, 3, 1]);
    expect(env.result.steps[2]!.conversionFromStart).toBeCloseTo(1 / 3);
  });

  it("breaks a funnel down by a property of the first step", async () => {
    const env = await provider().query({
      kind: "funnel",
      steps: [
        { event: "signed_up", filters: [] },
        { event: "profile_completed", filters: [] },
      ],
      windowSeconds: 7 * 86400,
      dateRange: range,
      breakdown: { type: "event", key: "$browser", limit: 5 },
      filters: [],
    });
    const byBrowser = Object.fromEntries(env.result.breakdowns!.map((b) => [b.value, b.steps.map((s) => s.count)]));
    expect(byBrowser).toEqual({ Chrome: [2, 2], Safari: [1, 0] });
  });

  it("filters on person properties", async () => {
    const env = await provider().query({
      kind: "trend",
      series: [{ event: null, math: "total", filters: [] }],
      interval: "month",
      dateRange: range,
      compare: false,
      filters: [{ type: "person", key: "email", operator: "eq", value: "alice@example.test" }],
    });
    // all events attributed to alice's person: anon-a(2 + identify) + alice(identify, onboarding, profile) + anon-d pageview + identify = 7
    expect(env.result.series[0]!.points[0]!.v).toBe(7);
  });

  it("paginates events with a keyset cursor", async () => {
    const p = provider();
    const first = await p.query({ kind: "events", dateRange: range, limit: 10, filters: [] });
    expect(first.result.rows).toHaveLength(10);
    const second = await p.query({ kind: "events", dateRange: range, limit: 10, filters: [], cursor: first.result.nextCursor! });
    const all = [...first.result.rows, ...second.result.rows];
    expect(new Set(all.map((r) => r.uuid)).size).toBe(17);
    expect(second.result.nextCursor).toBeNull();
  });

  it("redacts sensitive properties at ingest", async () => {
    const env = await provider().query({ kind: "events", event: "password_set", dateRange: range, limit: 5, filters: [] });
    expect(env.result.rows[0]!.properties).toMatchObject({ note: "ok" });
    expect(env.result.rows[0]!.properties).not.toHaveProperty("password");
  });

  it("keeps persons and merges consistent", async () => {
    const persons = await provider().listPersons({ kind: "persons", limit: 50 });
    const alice = persons.result.rows.find((r) => r.properties.email === "alice@example.test")!;
    expect(alice.isIdentified).toBe(true);
    expect(alice.distinctIds.sort()).toEqual(["alice", "anon-a", "anon-d"]);
    expect(persons.result.rows.filter((r) => r.isIdentified)).toHaveLength(2); // alice, bob
  });

  it("computes web stats with a documented bounce definition", async () => {
    const env = await provider().query({ kind: "web", dateRange: range });
    expect(env.result.pageviews).toBe(5);
    expect(env.result.sessions).toBe(4);
    // s-a (1 pv), s-c (1), s-d (1) bounce; s-b (2) does not => 3/4
    expect(env.result.bounceRate).toBeCloseTo(0.75);
    expect(env.result.topPages[0]).toMatchObject({ value: "/", count: 3 });
  });

  it("dates persons by their first event, not by ingest time", async () => {
    const env = await provider().query({ kind: "summary", dateRange: { from: "2026-11-11", to: "2026-11-13" } });
    // persons first seen on Nov 11-12: anon-c (11th) and carol (12th); anon-d merged into alice (10th)
    expect(env.result.newUsers).toBe(2);
  });

  it("never returns another project's data", async () => {
    const other = new NativeProvider({ db, ch: getClickHouse(), partitionId: otherProjectId, sourceId: otherProjectId, timezone: "UTC" });
    const env = await other.query({ kind: "summary", dateRange: range });
    expect(env.result.events).toBe(1);
    const mine = await provider().query({ kind: "summary", dateRange: range });
    expect(mine.result.events).toBe(17);
  });

  it("creates exactly one person per new distinct id when concurrent batches overlap", async () => {
    const [own] = await db.select().from(sources).where(eq(sources.id, sourceId));
    const [bulkSrc] = await db.insert(sources).values({ projectId: own!.projectId, kind: "native", label: "bulk" }).returning();
    const part = bulkSrc!.id;
    const ids = Array.from({ length: 120 }, (_, i) => `bulk-${i}`);
    const batch = (slice: string[]) => slice.map((d) => ({ uuid: randomUUID(), event: "$pageview", distinct_id: d, timestamp: day(14), properties: { $set_once: { first_page: "/" } } }));
    // three writers with separate caches (like three ingest instances), overlapping id ranges
    await Promise.all([
      ingestBatch(batch(ids.slice(0, 80)), { db, ch: getClickHouse(), dedup, partitionId: part, sourceId: part, knownIds: new KnownIdCache() }),
      ingestBatch(batch(ids.slice(40, 120)), { db, ch: getClickHouse(), dedup, partitionId: part, sourceId: part, knownIds: new KnownIdCache() }),
      ingestBatch(batch(ids.slice(20, 100)), { db, ch: getClickHouse(), dedup, partitionId: part, sourceId: part, knownIds: new KnownIdCache() }),
    ]);
    const rows = await db.select().from(nativePersonDistinctIds).where(eq(nativePersonDistinctIds.partitionId, part));
    expect(rows.length).toBe(120);
    expect(new Set(rows.map((r) => r.distinctId)).size).toBe(120);
  });
});
