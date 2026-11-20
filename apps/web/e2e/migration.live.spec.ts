/**
 * LIVE migration test against a real PostHog project (opt-in).
 *
 *   POSTHOG_LIVE_KEY=phx_… [POSTHOG_LIVE_TOKEN=phc_…] PW_CHROME_CHANNEL=chrome \
 *     npx playwright test e2e/migration.live.spec.ts
 *
 * WRITES to the PostHog project: during the parallel-run step a handful of events named
 * `hostpog_migration_test` / `$pageview` (property source=hostpog-migration-test) are
 * forwarded to PostHog. Everything else is read-only towards PostHog.
 */
import { expect, test, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";

const KEY = process.env.POSTHOG_LIVE_KEY ?? "";
const TOKEN = process.env.POSTHOG_LIVE_TOKEN;
test.skip(!KEY, "set POSTHOG_LIVE_KEY");
test.describe.configure({ mode: "serial", timeout: 240_000 });

const ORIGIN = "http://localhost:3000";
const hdr = { origin: ORIGIN, "content-type": "application/json" };

async function posthogCount(where: string): Promise<number> {
  const res = await fetch("https://us.posthog.com/api/projects/@current/query/", {
    method: "POST",
    headers: { Authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query: `SELECT count() FROM events WHERE timestamp > now() - INTERVAL 1 DAY AND ${where}` }, refresh: "force_blocking" }),
  });
  const j = (await res.json()) as { results?: number[][] };
  return Number(j.results?.[0]?.[0] ?? 0);
}

async function hostpogEvents(api: APIRequestContext, projectId: string, sourceId: string, run: string) {
  const r = await api.post(`/api/v1/projects/${projectId}/query`, {
    headers: hdr,
    data: { sourceId, query: { kind: "events", dateRange: { from: "-1d", to: "now" }, limit: 50, filters: [{ type: "event", key: "hostpog_run", operator: "eq", value: run }] } },
  });
  expect(r.status()).toBe(200);
  return ((await r.json()) as { result: { rows: { event: string; properties: Record<string, unknown> }[] } }).result.rows;
}

test("move a real PostHog project to HostPog", async ({ page, browser }) => {
  const api = page.request;
  // 1. account
  const email = `migrate-${randomUUID().slice(0, 8)}@example.test`;
  expect((await api.post("/api/auth/sign-up/email", { headers: hdr, data: { name: "Migrator", email, password: "migration-test-password-1" } })).status()).toBe(200);
  const me = (await (await api.get("/api/v1/me")).json()) as { workspaces: { projects: { id: string }[] }[] };
  const projectId = me.workspaces[0]!.projects[0]!.id;

  // 2. connect PostHog read-only
  const disc = (await (await api.post(`/api/v1/projects/${projectId}/posthog/discover`, { headers: hdr, data: { region: "us", apiKey: KEY } })).json()) as { projects: { id: string }[] };
  const connect = await api.post(`/api/v1/projects/${projectId}/posthog/connect`, { headers: hdr, data: { region: "us", apiKey: KEY, externalProjectId: disc.projects[0]!.id } });
  expect(connect.status()).toBe(201);

  // 3. start migration: token is read from PostHog and verified
  const setup = await api.post(`/api/v1/projects/${projectId}/migration`, { headers: hdr, data: { action: "setup" } });
  expect(setup.status(), await setup.text()).toBe(200);
  const migration = ((await setup.json()) as { migration: { posthogProjectToken: string; nativeSourceId: string } }).migration;
  if (TOKEN) expect(migration.posthogProjectToken).toBe(TOKEN);
  const nativeSourceId = migration.nativeSourceId;
  console.log(`✔ migration set up, token ${migration.posthogProjectToken.slice(0, 8)}… verified against PostHog`);

  // 4. product check
  const check = (await (await api.post(`/api/v1/projects/${projectId}/migration`, { headers: hdr, data: { action: "check_products" } })).json()) as {
    report: { products: { key: string; inUse: boolean | null; blocksCutover: boolean }[] };
  };
  expect(check.report.products.find((p) => p.key === "product_analytics")?.inUse).toBe(true);
  console.log(`✔ product check: ${check.report.products.map((p) => `${p.key}=${p.inUse}`).join(" ")}`);

  // 5. import history through the API, wait for completion
  const imp = await api.post(`/api/v1/projects/${projectId}/migration/import`, {
    headers: hdr,
    data: { from: new Date(Date.now() - 365 * 86400_000).toISOString(), to: new Date().toISOString() },
  });
  expect(imp.status(), await imp.text()).toBe(202);
  const jobId = ((await imp.json()) as { job: { id: string } }).job.id;
  let job: { status: string; importedEvents: number; estimatedRows: number; duplicateEvents: number } | undefined;
  for (let i = 0; i < 60; i++) {
    job = ((await (await api.get(`/api/v1/projects/${projectId}/migration/import/${jobId}`)).json()) as { job: typeof job }).job;
    if (job && ["complete", "failed"].includes(job.status)) break;
    await page.waitForTimeout(1000);
  }
  expect(job?.status).toBe("complete");
  expect(job!.importedEvents + job!.duplicateEvents).toBe(job!.estimatedRows);
  console.log(`✔ history import: ${job!.importedEvents} events (estimate ${job!.estimatedRows})`);

  // 6. real posthog-js → HostPog → forwarded to PostHog (parallel run)
  const run = `run-${randomUUID().slice(0, 8)}`;
  const flagsOk = page.waitForResponse((r) => r.url().includes("/ph/flags"), { timeout: 30_000 }).catch(() => null);
  const captured = page.waitForResponse((r) => r.url().includes("/ph/e/") && r.request().method() === "POST", { timeout: 30_000 });
  await page.goto(`http://localhost:4030/?token=${migration.posthogProjectToken}&api=${encodeURIComponent("http://localhost:3001/ph")}&run=${run}`);
  const cap = await captured;
  expect(cap.status()).toBe(200);
  const flags = await flagsOk;
  console.log(`✔ posthog-js sent ${cap.url().includes("compression=gzip-js") ? "gzip-js" : "uncompressed"} capture through HostPog${flags ? `; /flags proxied to PostHog → ${flags.status()}` : ""}`);
  await expect.poll(async () => (await hostpogEvents(api, projectId, nativeSourceId, run)).length, { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
  console.log("✔ event stored in HostPog");
  await expect.poll(() => posthogCount(`event = 'hostpog_migration_test' AND properties.hostpog_run = '${run}'`), { timeout: 150_000, intervals: [5000] }).toBe(1);
  console.log("✔ the same event arrived in PostHog (parallel run forwarding)");

  // 7. reconcile
  const rec = (await (await api.get(`/api/v1/projects/${projectId}/migration/reconcile?days=3`)).json()) as {
    days: { day: string; posthog: { events: number }; hostpog: { events: number }; status: string }[];
    byEvent: { event: string; posthog: number; hostpog: number }[];
  };
  console.log(`✔ reconciliation: ${rec.days.map((d) => `${d.day} PH=${d.posthog.events} HP=${d.hostpog.events} ${d.status}`).join(" | ")}`);

  // 8. cut over: events now go only to HostPog
  const cut = await api.post(`/api/v1/projects/${projectId}/migration`, { headers: hdr, data: { action: "cutover", confirm: true } });
  expect(cut.status(), await cut.text()).toBe(200);
  await page.waitForTimeout(11_000); // ingest route cache TTL
  const run2 = `run-${randomUUID().slice(0, 8)}`;
  const page2 = await browser.newPage();
  const cap2 = page2.waitForResponse((r) => r.url().includes("/ph/e/") && r.request().method() === "POST", { timeout: 30_000 });
  await page2.goto(`http://localhost:4030/?token=${migration.posthogProjectToken}&api=${encodeURIComponent("http://localhost:3001/ph")}&run=${run2}&event=hostpog_after_cutover`);
  expect((await cap2).status()).toBe(200);
  await expect.poll(async () => (await hostpogEvents(api, projectId, nativeSourceId, run2)).length, { timeout: 20_000 }).toBeGreaterThanOrEqual(1);
  await page.waitForTimeout(45_000);
  expect(await posthogCount(`event = 'hostpog_after_cutover' AND properties.hostpog_run = '${run2}'`)).toBe(0);
  console.log("✔ after cutover: stored in HostPog, nothing sent to PostHog");

  // 9. the migrate page renders the whole state
  await page.goto(`/app/p/${projectId}/migrate`);
  await expect(page.getByRole("heading", { name: "Move off PostHog" })).toBeVisible();
  await expect(page.getByText(/You.re on HostPog/)).toBeVisible();
  await page.screenshot({ path: "../../docs/screenshots/migrate-cut-over.png", fullPage: true });

  // 10. rollback restores the parallel run
  const rb = await api.post(`/api/v1/projects/${projectId}/migration`, { headers: hdr, data: { action: "rollback" } });
  expect(rb.status()).toBe(200);
  console.log("✔ rollback to parallel run works");

  // 11. another HostPog account cannot claim the same PostHog project
  const ctx2 = await browser.newContext({ baseURL: ORIGIN });
  const api2 = ctx2.request;
  await api2.post("/api/auth/sign-up/email", { headers: hdr, data: { name: "Other", email: `other-${randomUUID().slice(0, 8)}@example.test`, password: "migration-test-password-2" } });
  const p2id = ((await (await api2.get("/api/v1/me")).json()) as { workspaces: { projects: { id: string }[] }[] }).workspaces[0]!.projects[0]!.id;
  await api2.post(`/api/v1/projects/${p2id}/posthog/connect`, { headers: hdr, data: { region: "us", apiKey: KEY, externalProjectId: disc.projects[0]!.id } });
  const clash = await api2.post(`/api/v1/projects/${p2id}/migration`, { headers: hdr, data: { action: "setup" } });
  expect(clash.status()).toBe(409);
  await ctx2.close();
  console.log("✔ a second HostPog project gets 409 token_in_use");

  // 12. clean up so the PostHog token is free again
  expect((await api.post(`/api/v1/projects/${projectId}/migration`, { headers: hdr, data: { action: "remove" } })).status()).toBe(200);
});
