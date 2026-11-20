import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getDb, ingestionKeys, projects, sources, workspaces } from "@hostpog/db";
import { closeClickHouse, getClickHouse, migrateClickHouse, NativeProvider } from "@hostpog/native";
import { HostPogNode } from "../../../packages/sdk-node/src/index";
import { eq } from "drizzle-orm";
import { buildServer } from "../src/server";

let base = "";
let app: Awaited<ReturnType<typeof buildServer>>;
const db = getDb();
let projectId = "";
let sourceId = "";
let key = "";
let restrictedKey = "";

beforeAll(async () => {
  await migrateClickHouse();
  const [w] = await db.insert(workspaces).values({ name: "ingest-e2e" }).returning();
  const [p] = await db.insert(projects).values({ workspaceId: w!.id, name: "e2e", timezone: "UTC" }).returning();
  const [s] = await db.insert(sources).values({ projectId: p!.id, kind: "native", label: "native" }).returning();
  projectId = p!.id;
  sourceId = s!.id;
  key = `hp_pk_${randomBytes(18).toString("base64url")}`;
  restrictedKey = `hp_pk_${randomBytes(18).toString("base64url")}`;
  await db.insert(ingestionKeys).values([
    { projectId, sourceId, publicKey: key },
    { projectId, sourceId, publicKey: restrictedKey, allowedOrigins: ["https://app.example.test"] },
  ]);
  app = await buildServer({ logger: false });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}, 60_000);

afterAll(async () => {
  await app.close();
  await closeClickHouse();
});

describe("SDK → ingest → ClickHouse → query", () => {
  it("delivers events from @hostpog/node and they are queryable", async () => {
    const hp = new HostPogNode(key, { host: base, flushIntervalMs: 60_000 });
    const uuid = randomUUID();
    hp.identify({ distinctId: "user-42", anonymousId: "anon-42", properties: { email: "u42@example.test" } });
    hp.capture({ distinctId: "user-42", event: "invoice_paid", properties: { amount: 20 }, uuid });
    hp.capture({ distinctId: "user-42", event: "invoice_paid", properties: { amount: 20 }, uuid }); // retry duplicate
    hp.captureException(new Error("boom token=abc123"), "user-42");
    await hp.shutdown();

    const p = new NativeProvider({ db, ch: getClickHouse(), partitionId: sourceId, sourceId, timezone: "UTC" });
    const env = await p.query({ kind: "trend", series: [{ event: "invoice_paid", math: "total", filters: [] }], interval: "day", dateRange: { from: "-1d", to: "now" }, compare: false, filters: [] });
    expect(env.result.series[0]!.total).toBe(1);
    const ex = await p.query({ kind: "events", event: "$exception", dateRange: { from: "-1d", to: "now" }, limit: 5, filters: [] });
    expect(String(ex.result.rows[0]!.properties.$exception_message)).toBe("boom [redacted]");
    const person = await p.getPerson("anon-42");
    expect(person.result?.distinctIds.sort()).toEqual(["anon-42", "user-42"]);
  });

  it("rejects unknown and revoked keys", async () => {
    const bad = await fetch(`${base}/v1/batch`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ api_key: "hp_pk_doesnotexist000000", batch: [{}] }) });
    expect(bad.status).toBe(401);
    const k = `hp_pk_${randomBytes(18).toString("base64url")}`;
    await db.insert(ingestionKeys).values({ projectId, sourceId, publicKey: k, revokedAt: new Date() });
    const revoked = await fetch(`${base}/v1/capture`, { method: "POST", headers: { authorization: `Bearer ${k}`, "content-type": "application/json" }, body: JSON.stringify({ uuid: randomUUID(), event: "x", distinct_id: "d" }) });
    expect(revoked.status).toBe(401);
  });

  it("enforces per-key allowed origins", async () => {
    const body = JSON.stringify({ api_key: restrictedKey, batch: [{ uuid: randomUUID(), event: "o", distinct_id: "d" }] });
    const denied = await fetch(`${base}/v1/batch`, { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.test" }, body });
    expect(denied.status).toBe(403);
    const ok = await fetch(`${base}/v1/batch`, { method: "POST", headers: { "content-type": "application/json", origin: "https://app.example.test" }, body });
    expect(ok.status).toBe(200);
  });

  it("reports per-event validation failures without dropping the batch", async () => {
    const res = await fetch(`${base}/v1/batch`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ api_key: key, batch: [{ uuid: "not-a-uuid", event: "x", distinct_id: "d" }, { uuid: randomUUID(), event: "good", distinct_id: "d" }] }),
    });
    const j = (await res.json()) as { accepted: number; rejected: unknown[] };
    expect(res.status).toBe(200);
    expect(j.accepted).toBe(1);
    expect(j.rejected).toHaveLength(1);
  });

  it("stops accepting once the source is disconnected", async () => {
    await db.update(sources).set({ status: "disconnected" }).where(eq(sources.id, sourceId));
    const fresh = await buildServer({ logger: false }); // fresh key cache
    const res = await fresh.inject({ method: "POST", url: "/v1/batch", payload: { api_key: key, batch: [{ uuid: randomUUID(), event: "x", distinct_id: "d" }] } });
    expect(res.statusCode).toBe(401);
    await fresh.close();
    await db.update(sources).set({ status: "active" }).where(eq(sources.id, sourceId));
  });
});
