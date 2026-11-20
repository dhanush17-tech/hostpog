// Production smoke test. Runs against a deployed HostPog (default https://hostpog.vercel.app) with no local fixtures.
//   node e2e/prod-smoke.mjs [baseUrl] [ingestUrl]
// Creates a throwaway account, loads sample data, checks charts, sends one SDK event through ingest,
// verifies it lands, then deletes the data it created.
import { chromium } from "@playwright/test";
import { randomUUID } from "node:crypto";

const BASE = process.argv[2] ?? "https://hostpog.vercel.app";
const INGEST = process.argv[3] ?? "https://ingest-production-5c3ec2fa.up.railway.app";
const results = [];
const step = async (name, fn) => {
  const t = Date.now();
  try {
    await fn();
    results.push(["✓", name, `${((Date.now() - t) / 1000).toFixed(1)}s`]);
  } catch (e) {
    results.push(["✘", name, String(e.message ?? e).split("\n")[0].slice(0, 200)]);
    throw e;
  }
};

const browser = await chromium.launch(process.env.PW_CHROME_CHANNEL ? { channel: process.env.PW_CHROME_CHANNEL } : {});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
const api = (path, init = {}) =>
  page.evaluate(
    async ([p, i]) => {
      const r = await fetch(p, { ...i, headers: { "content-type": "application/json", ...(i.headers ?? {}) } });
      return { status: r.status, body: await r.json().catch(() => null) };
    },
    [path, init],
  );

let projectId = "";
let demoSource = "";
let nativeSource = "";
try {
  await step("landing page loads", async () => {
    await page.goto(BASE);
    await page.getByRole("heading", { level: 1 }).waitFor();
  });

  await step("sign up", async () => {
    await page.goto(`${BASE}/signup`);
    await page.getByLabel("Name").fill("Prod smoke");
    await page.getByLabel("Email").fill(`prod-smoke-${randomUUID().slice(0, 8)}@example.test`);
    await page.getByLabel("Password").fill("correct-horse-battery-staple");
    await page.getByRole("button", { name: "Create account" }).click();
    await page.getByRole("heading", { name: "Where is your product data?" }).waitFor({ timeout: 30_000 });
    projectId = new URL(page.url()).searchParams.get("project");
    if (!projectId) throw new Error("no project id after signup");
  });

  await step("load sample data into Tinybird", async () => {
    await page.getByRole("button", { name: "Explore the demo" }).click();
    await page.waitForURL(/\/overview\?source=/, { timeout: 120_000 });
    demoSource = new URL(page.url()).searchParams.get("source");
  });

  await step("overview shows numbers from Tinybird", async () => {
    await page.getByLabel("Ask the assistant").waitFor({ timeout: 30_000 });
    await page.getByText("Unique users").first().waitFor();
    await page.waitForFunction(() => /\d{3,}/.test(document.querySelector("main")?.innerText ?? ""), null, { timeout: 30_000 });
  });

  await step("funnel query runs", async () => {
    const r = await api(`/api/v1/projects/${projectId}/query`, {
      method: "POST",
      body: JSON.stringify({
        sourceId: demoSource,
        query: { kind: "funnel", steps: [{ event: "signed_up" }, { event: "onboarding_started" }], windowDays: 14, dateRange: { from: "-30d", to: "now" }, filters: [] },
      }),
    });
    if (r.status !== 200 || !(r.body?.result?.steps?.[0]?.count > 0)) throw new Error(`funnel: ${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  });

  await step("SDK event through Railway ingest lands in Tinybird", async () => {
    await page.goto(`${BASE}/app/onboarding/native?project=${projectId}`);
    const key = (await page.locator("code", { hasText: /^hp_pk_/ }).first().textContent()).trim();
    const res = await fetch(`${INGEST}/v1/capture`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ uuid: randomUUID(), event: "prod_smoke_event", distinct_id: "smoke-user", properties: { $pathname: "/smoke" } }),
    });
    if (res.status !== 200) throw new Error(`capture ${res.status}: ${(await res.text()).slice(0, 120)}`);
    await page.getByText("First event received").waitFor({ timeout: 60_000 });
    const s = await api(`/api/v1/projects/${projectId}/sources?all=1`);
    nativeSource = s.body?.sources?.find((x) => x.kind === "native")?.id ?? "";
  });

  await step("AI setup page offers Gemini / Claude / OpenAI", async () => {
    await page.goto(`${BASE}/app/p/${projectId}/settings/ai`);
    for (const n of ["Google Gemini", "Claude", "OpenAI"]) await page.getByText(n, { exact: true }).first().waitFor();
  });

  await step("no browser errors", async () => {
    if (errors.length) throw new Error(errors.slice(0, 3).join(" | "));
  });
} catch {
  /* recorded */
} finally {
  if (projectId) {
    for (const id of [demoSource, nativeSource].filter(Boolean)) {
      const r = await api(`/api/v1/projects/${projectId}/sources/${id}?mode=delete_data`, { method: "DELETE" });
      results.push([r.status === 200 ? "✓" : "✘", `cleanup: delete stored data (${id.slice(0, 8)})`, String(r.status)]);
    }
  }
  await page.screenshot({ path: "/tmp/prod-smoke-last.png" });
  await browser.close();
  for (const r of results) console.log(r.join("  "));
  process.exit(results.some((r) => r[0] === "✘") ? 1 : 0);
}
