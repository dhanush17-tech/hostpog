import { defineConfig, devices } from "@playwright/test";

/**
 * E2E against a production build (`next build` first). Uses real Postgres +
 * ClickHouse (env from ../../.env), a SYNTHETIC PostHog fixture and a SYNTHETIC
 * OpenAI-compatible model. Set PW_CHROME_CHANNEL=chrome to use an installed Chrome.
 */
const env = {
  ...process.env,
  HOSTPOG_POSTHOG_ALLOWED_HOSTS: "http://127.0.0.1:4010",
  HOSTPOG_AI_ALLOWED_PRIVATE_HOSTS: "127.0.0.1",
} as Record<string, string>;

export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  workers: 1,
  fullyParallel: false,
  reporter: [["list"]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...(process.env.PW_CHROME_CHANNEL ? { channel: process.env.PW_CHROME_CHANNEL } : {}),
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } },
  ],
  webServer: [
    { command: "npx tsx e2e/fixtures/mock-posthog.ts", port: 4010, reuseExistingServer: true, env },
    { command: "npx tsx e2e/fixtures/fake-llm.ts", port: 4020, reuseExistingServer: true, env },
    { command: "npx tsx e2e/fixtures/site.ts", port: 4030, reuseExistingServer: true, env },
    { command: "npx tsx ../ingest/src/server.ts", port: 3001, reuseExistingServer: true, env },
    { command: "npx next start --port 3000", port: 3000, reuseExistingServer: true, env, timeout: 120_000 },
  ],
});
