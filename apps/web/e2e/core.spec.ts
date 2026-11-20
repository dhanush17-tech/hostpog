import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

const MOCK_KEY = "phx_e2e_mock_key_0123456789abcdef";
const password = "correct-horse-battery-staple";

async function signUp(page: Page, name: string) {
  const email = `${name}-${randomUUID().slice(0, 8)}@example.test`;
  await page.goto("/signup");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Where is your product data?" })).toBeVisible();
  const projectId = new URL(page.url()).searchParams.get("project")!;
  return { email, projectId };
}

async function workspaceIdOf(page: Page, projectId: string) {
  const r = await page.request.get(`/api/v1/projects/${projectId}`);
  return ((await r.json()) as { project: { workspaceId: string } }).project.workspaceId;
}

test.describe.serial("HostPog core flows", () => {
  let projectId = "";
  let ownerEmail = "";
  let ownerCookies: Awaited<ReturnType<import("@playwright/test").BrowserContext["cookies"]>> = [];

  test("sign up lands on source choice", async ({ page }) => {
    const r = await signUp(page, "owner");
    projectId = r.projectId;
    ownerEmail = r.email;
    ownerCookies = await page.context().cookies();
    await expect(page.getByText("Connect to PostHog")).toBeVisible();
    await expect(page.getByText("Start collecting data")).toBeVisible();
    await expect(page.getByText("Import historical data")).toBeVisible();
  });

  test("sign in with email and password", async ({ page }) => {
    await page.goto("/login");
    await page.getByLabel("Email").fill(ownerEmail);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/app\//);
  });

  test("connect PostHog (fixture) read-only and see first metrics", async ({ page }) => {
    await page.context().addCookies(ownerCookies);
    await page.goto(`/app/onboarding/posthog?project=${projectId}`);
    await page.getByRole("radio", { name: "Self-hosted" }).click();
    await page.getByLabel("Instance URL").fill("http://127.0.0.1:4010");
    await page.getByLabel("Personal API key").fill(MOCK_KEY);
    await page.getByRole("button", { name: "Find my projects" }).click();
    await expect(page.getByText("E2E Web App")).toBeVisible();
    await page.getByRole("button", { name: "Connect read-only" }).click();
    await expect(page.getByRole("heading", { name: "Your last 7 days" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("4,210")).toBeVisible();
    await expect(page.getByText("session_recording:read")).toBeVisible(); // partial permissions are shown
    await expect(page.getByText(/move off PostHog/i).first()).toBeVisible();
    await page.getByRole("link", { name: /Go to my dashboard/ }).or(page.getByRole("button", { name: /Go to my dashboard/ })).first().click();
    await expect(page.getByLabel("Ask the assistant")).toBeVisible();
    await expect(page.getByText("388").first()).toBeVisible();
    // provenance is visible on insights
    await expect(page.locator("main").getByText(/PostHog · E2E Web App/).first()).toBeVisible();
    const calls = (await (await fetch("http://127.0.0.1:4010/__calls")).json()) as { method: string; path: string }[];
    expect(calls.every((c) => c.method === "GET" || c.path.endsWith("/query/"))).toBe(true);
  });

  test("trends page queries the connected source and saves to a dashboard", async ({ page }) => {
    await page.context().addCookies(ownerCookies);
    await page.goto(`/app/p/${projectId}/dashboards`);
    await page.getByRole("button", { name: "New dashboard" }).click();
    await page.getByLabel("Dashboard name").fill("Growth");
    await page.getByRole("button", { name: "Create" }).click();
    await expect(page.getByRole("link", { name: /Growth/ })).toBeVisible();
    await page.goto(`/app/p/${projectId}/trends`);
    await expect(page.getByRole("img", { name: /Trend chart/ })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Save" }).click();
    await page.getByLabel("Add to dashboard").selectOption({ label: "Growth" });
    await page.getByRole("button", { name: "Save insight" }).click();
    await expect(page.getByRole("button", { name: "Saved" })).toBeVisible();
    await page.goto(`/app/p/${projectId}/dashboards`);
    await page.getByRole("link", { name: /Growth/ }).click();
    await expect(page.getByRole("img", { name: /Trend chart/ })).toBeVisible({ timeout: 20_000 });
  });

  test("BYOK fake provider runs an evidence-backed investigation", async ({ page }) => {
    await page.context().addCookies(ownerCookies);
    await page.goto(`/app/p/${projectId}/settings/ai`);
    await page.getByText(/Other providers/).click();
    await page.getByLabel("Provider").selectOption("openai_compatible");
    await page.getByLabel("Endpoint URL").fill("http://127.0.0.1:4020/v1");
    await page.getByRole("button", { name: "Load models" }).click();
    await expect(page.getByLabel("Model")).toHaveValue("fake-analyst-1");
    await page.getByRole("button", { name: "Save provider" }).click();
    await expect(page.getByText("fake-analyst-1").first()).toBeVisible();
    const providerRow = page.locator("li", { hasText: "fake-analyst-1" }).first();
    await providerRow.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Test connection" }).click();
    await expect(providerRow.getByText("failing")).toHaveCount(0);
    await expect(providerRow.getByText(/Working · checked/)).toBeVisible();
    // a new model starts untested: the previous model's result must not carry over
    const list = await page.request.get(`/api/v1/workspaces/${await workspaceIdOf(page, projectId)}/ai-providers`);
    const prov = ((await list.json()) as { providers: { id: string; model: string }[] }).providers.find((x) => x.model === "fake-analyst-1")!;
    const wsUrl = `/api/v1/workspaces/${await workspaceIdOf(page, projectId)}/ai-providers/${prov.id}`;
    const h = { origin: "http://localhost:3000", "content-type": "application/json" };
    await page.request.patch(wsUrl, { headers: h, data: { model: "fake-analyst-2" } });
    const after = ((await (await page.request.get(`/api/v1/workspaces/${await workspaceIdOf(page, projectId)}/ai-providers`)).json()) as { providers: { id: string; model: string; lastTestResult: string | null }[] }).providers.find((x) => x.id === prov.id)!;
    expect(after).toMatchObject({ model: "fake-analyst-2", lastTestResult: null });
    await page.request.patch(wsUrl, { headers: h, data: { model: "fake-analyst-1" } });
    await page.request.post(wsUrl, { headers: h, data: {} });

    await page.goto(`/app/p/${projectId}/investigations`);
    await page.getByLabel("What do you want to know?").fill("Did signups change in the last two weeks?");
    await page.getByRole("button", { name: "Investigate" }).click();
    await expect(page.getByRole("heading", { name: "Signups are flat week over week" })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("signed_up trend compared with previous period")).toBeVisible();
    const observed = page.locator("article section", { has: page.getByRole("heading", { name: "Observed in the data" }) });
    await expect(observed).not.toContainText("fabricated claim");
    await expect(page.getByText(/Some model claims were removed/)).toBeVisible();
    await expect(page.locator("#evidence-ev_01")).toBeVisible();
  });

  test("native SDK event appears in the event explorer", async ({ page, request }) => {
    await page.context().addCookies(ownerCookies);
    await page.goto(`/app/onboarding/native?project=${projectId}`);
    const key = (await page.locator("code", { hasText: /^hp_pk_/ }).first().textContent())!.trim();
    await expect(page.getByText(/Waiting for your first event/)).toBeVisible();
    const res = await request.post("http://127.0.0.1:3001/v1/capture", {
      headers: { authorization: `Bearer ${key}` },
      data: { uuid: randomUUID(), event: "e2e_native_event", distinct_id: "e2e-user", properties: { $pathname: "/e2e" } },
    });
    expect(res.status()).toBe(200);
    await expect(page.getByText("First event received")).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: "Open the event explorer" }).click();
    await expect(page.getByRole("cell", { name: "e2e_native_event" })).toBeVisible({ timeout: 20_000 });
    await page.getByRole("cell", { name: "e2e_native_event" }).click();
    await expect(page.getByRole("dialog", { name: "e2e_native_event" })).toContainText('"$pathname": "/e2e"');
  });

  test("assistant answers from data and creates a flag that starts off", async ({ page }) => {
    await page.context().addCookies(ownerCookies);
    await page.goto(`/app/p/${projectId}/overview`);
    // the home prompt hands the question to the assistant and sends it
    await page.getByLabel("Ask the assistant").fill("How many signups in the last two weeks?");
    await page.getByLabel("Ask the assistant").press("Enter");
    const panel = page.getByRole("dialog", { name: "AI assistant" });
    await expect(panel.getByText("Signups over the last 14 days")).toBeVisible({ timeout: 30_000 });
    await expect(panel.getByRole("img", { name: /Trend chart/ })).toHaveCount(1); // only the chart the answer is about
    await expect(panel.getByText("Signups per day")).toBeVisible();
    await panel.getByLabel("Message").fill("Create a flag for the new onboarding at 20%");
    await panel.getByLabel("Message").press("Enter");
    await expect(panel.getByRole("link", { name: /new-onboarding/ })).toBeVisible({ timeout: 30_000 });
    await panel.getByRole("link", { name: /new-onboarding/ }).click();
    await expect(page.getByText("new-onboarding").first()).toBeVisible();
    const flags = await page.request.get(`/api/v1/projects/${projectId}/flags`);
    const f = ((await flags.json()) as { flags: { key: string; active: boolean; rolloutPercent: number }[] }).flags.find((x) => x.key === "new-onboarding");
    expect(f).toMatchObject({ active: false, rolloutPercent: 20 });
  });

  test("flags, surveys and logs work over the HostPog key and posthog-js endpoints", async ({ page, request }) => {
    await page.context().addCookies(ownerCookies);
    const h = { origin: "http://localhost:3000", "content-type": "application/json" };
    await page.goto(`/app/onboarding/native?project=${projectId}`);
    const key = (await page.locator("code", { hasText: /^hp_pk_/ }).first().textContent())!.trim();

    const flag = await page.request.post(`/api/v1/projects/${projectId}/flags`, { headers: h, data: { key: "e2e-beta", name: "Beta", rolloutPercent: 100, conditions: [{ type: "person", property: "plan", operator: "eq", value: "pro" }] } });
    expect(flag.status()).toBe(201);
    const ingest = "http://127.0.0.1:3001";
    const native = await (await request.post(`${ingest}/v1/flags`, { headers: { authorization: `Bearer ${key}` }, data: { distinct_id: "u-pro", person_properties: { plan: "pro" } } })).json();
    expect(native.flags["e2e-beta"]).toBe(true);
    const free = await (await request.post(`${ingest}/v1/flags`, { headers: { authorization: `Bearer ${key}` }, data: { distinct_id: "u-free", person_properties: { plan: "free" } } })).json();
    expect(free.flags["e2e-beta"]).toBe(false);
    const ph = await (await request.post(`${ingest}/ph/flags/?v=2`, { data: { token: key, distinct_id: "u-pro", person_properties: { plan: "pro" } } })).json();
    expect(ph.flags["e2e-beta"].enabled).toBe(true);

    const survey = await page.request.post(`/api/v1/projects/${projectId}/surveys`, { headers: h, data: { name: "E2E NPS", questions: [{ type: "rating", question: "How likely are you to recommend us?", scale: 10 }] } });
    expect(survey.status()).toBe(201);
    const sid = ((await survey.json()) as { survey: { id: string } }).survey.id;
    await page.request.patch(`/api/v1/projects/${projectId}/surveys/${sid}`, { headers: h, data: { action: "launch" } });
    await expect
      .poll(async () => JSON.stringify(await (await request.get(`${ingest}/ph/api/surveys/?token=${key}`)).json()), { timeout: 15_000 })
      .toContain("How likely are you to recommend us?");

    const logs = await request.post(`${ingest}/ph/i/v1/logs?token=${key}`, {
      data: { resourceLogs: [{ resource: { attributes: [{ key: "service.name", value: { stringValue: "checkout" } }] }, scopeLogs: [{ logRecords: [{ severityText: "ERROR", body: { stringValue: "e2e payment declined" } }] }] }] },
    });
    expect(logs.status()).toBe(200);
    await page.goto(`/app/p/${projectId}/logs`);
    await page.getByLabel("Search log messages").fill("payment declined");
    await expect(page.getByText("e2e payment declined")).toBeVisible({ timeout: 20_000 });

    for (const [path, heading] of [["flags", "Feature flags"], ["experiments", "Experiments"], ["surveys", "Surveys"], ["workflows", "Workflows"], ["llm", "LLM analytics"]] as const) {
      await page.goto(`/app/p/${projectId}/${path}`);
      await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
    }
  });

  test("a teammate joins through an invite link and lands in the shared project, with no setup", async ({ page, browser }) => {
    await page.context().addCookies(ownerCookies);
    const ws = await workspaceIdOf(page, projectId);
    const h = { origin: "http://localhost:3000", "content-type": "application/json" };
    const open = await page.request.post(`/api/v1/workspaces/${ws}/invites`, { headers: h, data: { role: "member" } });
    expect(open.status()).toBe(201);
    const { url } = (await open.json()) as { url: string };

    // a brand-new person: invite page → sign up → straight into the team's project
    const ctx = await browser.newContext();
    const mate = await ctx.newPage();
    await mate.goto(new URL(url).pathname);
    await expect(mate.getByRole("heading", { name: /^Join / })).toBeVisible();
    await mate.getByRole("link", { name: "Create an account and join" }).click();
    await mate.getByLabel("Name").fill("Teammate");
    await mate.getByLabel("Email").fill(`mate-${randomUUID().slice(0, 8)}@example.test`);
    await mate.getByLabel("Password").fill(password);
    await mate.getByRole("button", { name: "Create account" }).click();
    await expect(mate).toHaveURL(new RegExp(`/app/p/${projectId}/overview`), { timeout: 20_000 });
    await expect(mate.getByLabel("Ask the assistant")).toBeVisible();
    // no personal workspace was created for them: the team's is their only one
    const mine = await mate.request.get("/app");
    expect(mine.url()).toContain(`/app/p/${projectId}/`);
    await ctx.close();

    // the owner sees them as a member
    const members = (await (await page.request.get(`/api/v1/workspaces/${ws}/members`)).json()) as { members: { name: string; role: string }[] };
    expect(members.members.find((m) => m.name === "Teammate")?.role).toBe("member");

    // an invite bound to an email can't be used by someone else
    const bound = await page.request.post(`/api/v1/workspaces/${ws}/invites`, { headers: h, data: { email: "someone-else@example.test", role: "viewer" } });
    const boundUrl = ((await bound.json()) as { url: string }).url;
    const ctx2 = await browser.newContext();
    const other = await ctx2.newPage();
    await other.goto(`${new URL(boundUrl).pathname}`);
    await other.getByRole("link", { name: "Create an account and join" }).click();
    await expect(other.getByLabel("Email")).toHaveValue("someone-else@example.test");
    await other.getByLabel("Email").fill(`wrong-${randomUUID().slice(0, 8)}@example.test`);
    await other.getByLabel("Name").fill("Wrong person");
    await other.getByLabel("Password").fill(password);
    await other.getByRole("button", { name: "Create account" }).click();
    await expect(other.getByText(/This invite is for someone-else@example.test/)).toBeVisible({ timeout: 20_000 });
    await ctx2.close();
  });

  test("another tenant cannot access this project", async ({ page, request }) => {
    await signUp(page, "intruder");
    await page.goto(`/app/p/${projectId}/overview`);
    await expect(page.getByText(/404|could not be found/i).first()).toBeVisible();
    const api = await page.request.post(`/api/v1/projects/${projectId}/query`, {
      headers: { origin: "http://localhost:3000", "content-type": "application/json" },
      data: { query: { kind: "summary", dateRange: { from: "-7d", to: "now" } } },
    });
    expect(api.status()).toBe(404);
    const anon = await request.get(`/api/v1/projects/${projectId}/sources`);
    expect(anon.status()).toBe(401);
  });

  test("cross-origin writes are rejected (CSRF)", async ({ page }) => {
    await page.context().addCookies(ownerCookies);
    const r = await page.request.post(`/api/v1/projects/${projectId}/dashboards`, { headers: { origin: "https://evil.example", "content-type": "application/json" }, data: { name: "x" } });
    expect(r.status()).toBe(403);
  });

  test("move off PostHog starts automatically and walks through the steps", async ({ page }) => {
    await page.context().addCookies(ownerCookies);
    await page.goto(`/app/p/${projectId}/migrate?start=1`);
    await expect(page.getByRole("heading", { name: "See what moves over" })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText(/moves over/).first()).toBeVisible({ timeout: 20_000 });
    await page.getByRole("button", { name: /Point your app at HostPog/ }).click();
    await expect(page.getByText('api_host: "http://localhost:3001/ph",')).toBeVisible();
    await expect(page.getByRole("button", { name: /Copy prompt for your coding agent/ })).toBeVisible();
    await page.screenshot({ path: "../../docs/screenshots/migrate-step-2.png", fullPage: true });
    await page.getByRole("button", { name: /Copy your history/ }).first().click();
    await expect(page.getByRole("button", { name: "Copy my history" })).toBeVisible();
  });

  test("history import runs to completion (in-process or on the ingest worker)", async ({ page }) => {
    await page.context().addCookies(ownerCookies);
    await page.goto(`/app/p/${projectId}/migrate`);
    const origin = new URL(page.url()).origin;
    const to = new Date().toISOString();
    const from = new Date(Date.now() - 14 * 86400_000).toISOString();
    const start = await page.request.post(`/api/v1/projects/${projectId}/migration/import`, { data: { from, to }, headers: { origin } });
    expect(start.status(), await start.text()).toBeLessThan(300);
    const { job } = (await start.json()) as { job: { id: string } };
    let last: { status: string; importedEvents: number; error: string | null } | undefined;
    await expect
      .poll(
        async () => {
          const r = await page.request.get(`/api/v1/projects/${projectId}/migration/import/${job.id}`);
          last = ((await r.json()) as { job: typeof last }).job;
          return last?.status;
        },
        { timeout: 60_000, intervals: [1000] },
      )
      .toBe("complete");
    expect(last!.importedEvents).toBeGreaterThan(0);
  });

  test("disconnect removes the PostHog credential", async ({ page }) => {
    await page.context().addCookies(ownerCookies);
    await page.goto(`/app/p/${projectId}/settings/integrations`);
    page.once("dialog", (d) => d.accept());
    const row = page.locator("li", { hasText: "PostHog · E2E Web App" }).first();
    await row.getByRole("button", { name: "More actions" }).click();
    await page.getByRole("menuitem", { name: "Disconnect" }).click();
    await expect(page.getByText(/Disconnected and credential removed/)).toBeVisible();
    const sources = await page.request.get(`/api/v1/projects/${projectId}/sources?all=1`);
    const j = (await sources.json()) as { sources: { kind: string; status: string; credential: unknown }[] };
    const ph = j.sources.find((s) => s.kind === "posthog")!;
    expect(ph.status).toBe("disconnected");
    expect(ph.credential).toBeNull();
  });
});
