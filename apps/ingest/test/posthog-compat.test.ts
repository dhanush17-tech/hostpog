import { randomUUID } from "node:crypto";
import { gzipSync } from "node:zlib";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { getDb, migrations, projects, sources, workspaces } from "@hostpog/db";
import { closeClickHouse, getClickHouse, migrateClickHouse, NativeProvider } from "@hostpog/native";
import { buildServer } from "../src/server";

const db = getDb();
const token = `phc_test_${randomUUID().replace(/-/g, "")}`;
let nativeId = "";
let migrationId = "";
const forwarded: { url: string; body: Buffer; headers: Record<string, string> }[] = [];
const fakeFetch = (async (url: string | URL, init?: RequestInit) => {
  const u = String(url);
  forwarded.push({ url: u, body: Buffer.from((init?.body as Uint8Array) ?? []), headers: (init?.headers ?? {}) as Record<string, string> });
  if (u.includes("/flags")) return new Response(JSON.stringify({ flags: { "new-checkout": { enabled: true } } }), { headers: { "content-type": "application/json" } });
  return new Response(JSON.stringify({ status: "Ok" }), { headers: { "content-type": "application/json" } });
}) as typeof fetch;
let app: Awaited<ReturnType<typeof buildServer>>;

beforeAll(async () => {
  await migrateClickHouse();
  const [w] = await db.insert(workspaces).values({ name: "compat" }).returning();
  const [p] = await db.insert(projects).values({ workspaceId: w!.id, name: "compat" }).returning();
  const [n] = await db.insert(sources).values({ projectId: p!.id, kind: "native", label: "HostPog" }).returning();
  nativeId = n!.id;
  const [m] = await db
    .insert(migrations)
    .values({ projectId: p!.id, nativeSourceId: nativeId, posthogProjectToken: token, captureHost: "https://us.i.posthog.com", assetsHost: "https://us-assets.i.posthog.com", forwarding: true })
    .returning();
  migrationId = m!.id;
  app = await buildServer({ logger: false, fetchImpl: fakeFetch });
}, 60_000);
afterAll(async () => {
  await app.close();
  await closeClickHouse();
});

const ev = (event: string, extra: Record<string, unknown> = {}) => ({
  uuid: randomUUID(),
  event,
  timestamp: new Date().toISOString(),
  properties: { distinct_id: "ph-user-1", token, $lib: "web", $session_id: "sess-1", ...extra },
});

describe("PostHog-compatible capture", () => {
  it("accepts posthog-js gzip-js batches, stores them and forwards the exact bytes", async () => {
    const payload = gzipSync(JSON.stringify([ev("$pageview", { $pathname: "/" }), ev("clicked_buy")]));
    const res = await app.inject({ method: "POST", url: "/ph/e/?ip=1&_=123&ver=1.451.1&compression=gzip-js", payload, headers: { "content-type": "text/plain" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().hostpog.accepted).toBe(2);
    const f = forwarded.at(-1)!;
    expect(f.url).toBe("https://us.i.posthog.com/e/?ip=1&_=123&ver=1.451.1&compression=gzip-js");
    expect(f.body.equals(payload)).toBe(true);
  });

  it("accepts the base64 form encoding", async () => {
    const data = Buffer.from(JSON.stringify(ev("signed_up"))).toString("base64");
    const res = await app.inject({ method: "POST", url: "/ph/e/?compression=base64", payload: `data=${encodeURIComponent(data)}`, headers: { "content-type": "application/x-www-form-urlencoded" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().hostpog.accepted).toBe(1);
  });

  it("accepts server-SDK /batch/ payloads with top-level distinct_id and api_key", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/ph/batch/",
      payload: { api_key: token, batch: [{ event: "invoice_paid", distinct_id: "ph-user-1", properties: { amount: 5 }, timestamp: new Date().toISOString() }] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().hostpog.accepted).toBe(1);
  });

  it("de-duplicates SDK retries by uuid", async () => {
    const e = ev("retry_me");
    const body = gzipSync(JSON.stringify([e]));
    await app.inject({ method: "POST", url: "/ph/e/?compression=gzip-js", payload: body, headers: { "content-type": "text/plain" } });
    const second = await app.inject({ method: "POST", url: "/ph/e/?compression=gzip-js", payload: body, headers: { "content-type": "text/plain" } });
    expect(second.json().hostpog).toMatchObject({ accepted: 0, duplicates: 1 });
  });

  it("rejects unknown project tokens", async () => {
    const res = await app.inject({ method: "POST", url: "/ph/e/", payload: [{ event: "x", properties: { distinct_id: "a", token: "phc_unknown" } }] });
    expect(res.statusCode).toBe(401);
  });

  it("proxies feature flags and remote config to PostHog while in parallel mode", async () => {
    const flags = await app.inject({ method: "POST", url: "/ph/flags/?v=2", payload: { token, distinct_id: "ph-user-1" } });
    expect(flags.json().flags["new-checkout"].enabled).toBe(true);
    await app.inject({ method: "GET", url: `/ph/array/${token}/config.js` });
    expect(forwarded.at(-1)!.url).toBe(`https://us-assets.i.posthog.com/array/${token}/config.js`);
  });

  it("stores events queryable in HostPog with PostHog's identity semantics", async () => {
    const anon = `anon-${randomUUID()}`;
    await app.inject({ method: "POST", url: "/ph/e/", payload: [{ ...ev("$pageview"), properties: { distinct_id: anon, token } }] });
    await app.inject({ method: "POST", url: "/ph/e/", payload: [{ ...ev("$identify"), properties: { distinct_id: "real-user-9", $anon_distinct_id: anon, token, $set: { email: "nine@example.test" } } }] });
    const p = new NativeProvider({ db, ch: getClickHouse(), partitionId: nativeId, sourceId: nativeId, timezone: "UTC" });
    const person = await p.getPerson(anon);
    expect(person.result?.distinctIds.sort()).toEqual([anon, "real-user-9"].sort());
    expect(person.result?.properties.email).toBe("nine@example.test");
    const env = await p.query({ kind: "summary", dateRange: { from: "-1d", to: "now" } });
    expect(env.result.events).toBeGreaterThanOrEqual(6);
  });

  it("after cutover: nothing is sent to PostHog and flags answer safely", async () => {
    await db.update(migrations).set({ forwarding: false }).where(eq(migrations.id, migrationId));
    const fresh = await buildServer({ logger: false, fetchImpl: fakeFetch });
    const before = forwarded.length;
    const cap = await fresh.inject({ method: "POST", url: "/ph/e/", payload: [ev("after_cutover")] });
    expect(cap.statusCode).toBe(200);
    const flags = await fresh.inject({ method: "POST", url: "/ph/flags/?v=2", payload: { token, distinct_id: "x" } });
    expect(flags.json()).toMatchObject({ flags: {}, errorsWhileComputingFlags: false });
    const rec = await fresh.inject({ method: "POST", url: "/ph/s/", payload: [{ event: "$snapshot", properties: { token, distinct_id: "x" } }] });
    expect(rec.json()).toMatchObject({ stored: false });
    expect(forwarded.length).toBe(before);
    await fresh.close();
  });

  it("records forwarding health for the migration page", async () => {
    await app.close(); // flushes counters
    const [m] = await db.select().from(migrations).where(eq(migrations.id, migrationId));
    expect(m!.forwardedRequests).toBeGreaterThanOrEqual(4);
    expect(m!.capturedViaProxy).toBeGreaterThanOrEqual(6);
    expect(m!.trackingFirstSeenAt).not.toBeNull();
    app = await buildServer({ logger: false, fetchImpl: fakeFetch });
  });
});
