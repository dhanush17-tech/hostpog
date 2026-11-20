import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { featureFlags, getDb, ingestionKeys, projects, sources, surveys, workflowRuns, workflows, workspaces } from "@hostpog/db";
import { closeClickHouse, migrateClickHouse } from "@hostpog/native";
import { eq } from "drizzle-orm";
import { buildServer } from "../src/server";
import { renderMessage } from "../src/workflow-delivery";

let base = "";
let app: Awaited<ReturnType<typeof buildServer>>;
const db = getDb();
let projectId = "";
let key = "";
let workflowId = "";

beforeAll(async () => {
  await migrateClickHouse();
  const [w] = await db.insert(workspaces).values({ name: "products-e2e" }).returning();
  const [p] = await db.insert(projects).values({ workspaceId: w!.id, name: "products", timezone: "UTC" }).returning();
  const [s] = await db.insert(sources).values({ projectId: p!.id, kind: "native", label: "native" }).returning();
  projectId = p!.id;
  key = `hp_pk_${randomBytes(18).toString("base64url")}`;
  await db.insert(ingestionKeys).values({ projectId, sourceId: s!.id, publicKey: key });
  await db.insert(featureFlags).values([
    { projectId, key: "new-checkout", variants: [{ key: "control", rolloutPercent: 50 }, { key: "test", rolloutPercent: 50 }], payloads: { test: { color: "orange" } } },
    { projectId, key: "pro-only", conditions: [{ property: "plan", operator: "eq", value: "pro" }] },
    { projectId, key: "off", active: false },
  ]);
  await db.insert(surveys).values({
    projectId,
    name: "NPS",
    status: "active",
    urlContains: "/app",
    questions: [{ id: "q1", type: "rating", question: "How likely are you to recommend us?", isNps: true }],
  });
  const [wf] = await db
    .insert(workflows)
    .values({ projectId, name: "Big invoice", trigger: { type: "event", event: "invoice_paid", filters: [{ property: "amount", operator: "gt", value: 100 }] }, action: { type: "webhook", url: "https://hooks.example.test/x" } })
    .returning();
  workflowId = wf!.id;
  app = await buildServer({ logger: false });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  base = `http://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}`;
}, 60_000);

afterAll(async () => {
  await app.close();
  await closeClickHouse();
});

describe("posthog-js protocol with a HostPog project key", () => {
  it("evaluates flags at /ph/flags in posthog-js v2 format", async () => {
    const r = await fetch(`${base}/ph/flags/?v=2`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: key, distinct_id: "user_1", person_properties: { plan: "pro" } }),
    });
    expect(r.status).toBe(200);
    const j = (await r.json()) as { flags: Record<string, { enabled: boolean; variant?: string }>; featureFlags: Record<string, unknown> };
    expect(j.flags["new-checkout"]).toMatchObject({ enabled: true, variant: "control" }); // same bucket as PostHog
    expect(j.flags["pro-only"]!.enabled).toBe(true);
    expect(j.flags.off!.enabled).toBe(false);
    expect(j.featureFlags["new-checkout"]).toBe("control");
  });

  it("serves active surveys and a remote config that turns surveys on", async () => {
    const s = (await (await fetch(`${base}/ph/api/surveys/?token=${key}`)).json()) as { surveys: { name: string; questions: { scale?: number }[]; conditions: { url?: string } }[] };
    expect(s.surveys).toHaveLength(1);
    expect(s.surveys[0]).toMatchObject({ name: "NPS", conditions: { url: "/app" } });
    expect(s.surveys[0]!.questions[0]!.scale).toBe(10);
    const c = (await (await fetch(`${base}/ph/array/${key}/config`)).json()) as { surveys: boolean; hasFeatureFlags: boolean };
    expect(c).toMatchObject({ surveys: true, hasFeatureFlags: true });
  });

  it("accepts posthog-js capture with a HostPog key", async () => {
    const r = await fetch(`${base}/ph/e/`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ api_key: key, event: "$pageview", distinct_id: "user_1", properties: { $current_url: "https://x.test/app" }, uuid: randomUUID() }),
    });
    expect(r.status).toBe(200);
  });

  it("serves flags to the HostPog SDK at /v1/flags", async () => {
    const r = await fetch(`${base}/v1/flags`, { method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ distinct_id: "user_1" }) });
    const j = (await r.json()) as { flags: Record<string, unknown>; payloads: Record<string, unknown> };
    expect(j.flags["new-checkout"]).toBe("control");
    expect(j.flags["pro-only"]).toBe(false);
  });
});

describe("workflows", () => {
  it("queues a run only for events that match the trigger", async () => {
    const send = (amount: number) =>
      fetch(`${base}/v1/capture`, {
        method: "POST",
        headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ uuid: randomUUID(), event: "invoice_paid", distinct_id: "user_9", properties: { amount } }),
      });
    expect((await send(50)).status).toBe(200);
    expect((await send(500)).status).toBe(200);
    await new Promise((r) => setTimeout(r, 300));
    const runs = await db.select().from(workflowRuns).where(eq(workflowRuns.workflowId, workflowId));
    expect(runs).toHaveLength(1);
    expect((runs[0]!.event.properties as { amount: number }).amount).toBe(500);
  });

  it("renders Slack message placeholders", () => {
    expect(renderMessage("{event} by {distinct_id}: {properties.amount} {missing}", { event: "invoice_paid", distinct_id: "u", properties: { amount: 5 } })).toBe("invoice_paid by u: 5 {missing}");
  });
});
