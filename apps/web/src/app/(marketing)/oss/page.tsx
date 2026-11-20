import { DocPage } from "@/components/prose";

export const metadata = { title: "Open source & roadmap" };

const ROADMAP: [string, string][] = [
  ["Product analytics: trends, funnels, retention, people, web analytics, dashboards", "Available"],
  ["AI investigations and the assistant, with your own model", "Available"],
  ["Native SDKs, posthog-js compatible ingest, ClickHouse or Tinybird storage", "Available"],
  ["Migrate from PostHog, history import included", "Available"],
  ["Feature flags, experiments, surveys", "Available"],
  ["LLM analytics, logs, workflows (Slack and webhooks)", "Available"],
  ["Session replay, error tracking", "Next"],
  ["Email and multi-step workflows, cohorts", "Later"],
];

export default function Oss() {
  return (
    <DocPage title="Open source" lead="hostpog is MIT licensed. No license checks, no cloud-only features, no telemetry.">
      <h2>License</h2>
      <p>
        MIT. hostpog is an independent project by DevLabs and is not affiliated with or endorsed by PostHog Inc.
      </p>
      <h2>Pricing</h2>
      <p>The self-hosted software is free. You pay for your own infrastructure and, if you use investigations, your AI provider.</p>
      <h2>Roadmap</h2>
      <table>
        <thead>
          <tr>
            <th>Area</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {ROADMAP.map(([s, st]) => (
            <tr key={s}>
              <td>{s}</td>
              <td>{st}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </DocPage>
  );
}
