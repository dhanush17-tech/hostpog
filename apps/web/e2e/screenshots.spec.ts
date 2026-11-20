/**
 * Captures real screenshots (SYNTHETIC demo data) for docs and the landing page.
 * Run: SCREENSHOTS=1 pnpm test:e2e e2e/screenshots.spec.ts
 */
import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import path from "node:path";

const OUT = path.join(import.meta.dirname, "../../../docs/screenshots");
test.skip(!process.env.SCREENSHOTS, "set SCREENSHOTS=1");

test("capture product screenshots", async ({ page, browser }) => {
  test.setTimeout(240_000);
  await page.goto("/signup");
  await page.getByLabel("Name").fill("Demo");
  await page.getByLabel("Email").fill(`demo-${randomUUID().slice(0, 6)}@example.test`);
  await page.getByLabel("Password").fill("correct-horse-battery-staple");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Where is your product data?" })).toBeVisible();
  await page.screenshot({ path: `${OUT}/onboarding-desktop.png` });
  await page.getByRole("button", { name: "Explore the demo" }).click();
  await page.waitForURL(/overview/, { timeout: 120_000 });
  const projectId = page.url().split("/app/p/")[1]!.split("/")[0]!;
  const qs = new URL(page.url()).search;
  // configure the overview funnel before capturing
  await page.getByLabel("Step 1").fill("signed_up");
  await page.getByLabel("Step 2").fill("onboarding_started");
  await page.getByRole("button", { name: "Add step" }).click();
  await page.getByLabel("Step 3").fill("profile_completed");
  await page.getByRole("button", { name: "Show funnel" }).click();
  await expect(page.getByText("Median time to convert")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(800);
  await page.setViewportSize({ width: 1440, height: 1320 });
  await page.screenshot({ path: `${OUT}/overview-desktop.png` });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.screenshot({ path: path.join(import.meta.dirname, "../public/landing/app-overview.png") });

  await page.goto(`/app/p/${projectId}/funnels${qs}`);
  await page.getByLabel("Step 1").fill("signed_up");
  await page.getByLabel("Step 2").fill("profile_completed");
  await page.keyboard.press("Escape");
  await page.getByPlaceholder("Break down by (e.g. $browser)").fill("$browser");
  await expect(page.getByRole("cell", { name: "Safari" })).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: `${OUT}/funnel-breakdown-desktop.png`, });

  await page.goto(`/app/p/${projectId}/web${qs}`);
  await expect(page.getByText("Bounce rate")).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: `${OUT}/web-desktop.png` });

  await page.goto(`/app/p/${projectId}/events${qs}`);
  await expect(page.getByRole("cell").first()).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: `${OUT}/events-desktop.png` });

  // mobile + dark mode checks
  const cookies = await page.context().cookies();
  const mobile = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true, colorScheme: "dark" });
  await mobile.addCookies(cookies);
  const m = await mobile.newPage();
  await m.goto(`/app/p/${projectId}/overview${qs}`);
  await expect(m.getByText("Unique users").first()).toBeVisible({ timeout: 30_000 });
  await m.waitForTimeout(800);
  await m.screenshot({ path: `${OUT}/overview-mobile-dark.png`, fullPage: true });
  const width = await m.evaluate(() => document.documentElement.scrollWidth);
  expect(width).toBeLessThanOrEqual(380); // no horizontal overflow at 375px
  await m.getByRole("button", { name: "Open navigation" }).click();
  await m.screenshot({ path: `${OUT}/nav-mobile-dark.png` });
  await mobile.close();

  const landing = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const l = await landing.newPage();
  await l.goto("/");
  await l.screenshot({ path: `${OUT}/landing-desktop.png`, fullPage: true });
  const lm = await browser.newContext({ viewport: { width: 375, height: 812 }, isMobile: true });
  const lmp = await lm.newPage();
  await lmp.goto("/");
  await lmp.screenshot({ path: `${OUT}/landing-mobile.png`, fullPage: true });
  expect(await lmp.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(380);
});
