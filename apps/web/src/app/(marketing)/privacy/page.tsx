import { DocPage } from "@/components/prose";

export const metadata = { title: "Privacy & data flow" };

export default function Privacy() {
  return (
    <DocPage title="Privacy & data flow" lead="What the software does with data. This describes product behaviour, not a legal agreement; operators of a HostPog instance are responsible for their own policies.">
      <h2>Stored by HostPog</h2>
      <ul>
        <li>Accounts (name, email, password hash), workspaces, projects, roles.</li>
        <li>Credentials for PostHog and AI providers, encrypted with AES-256-GCM bound to the owning workspace. Keys are never returned to the browser after saving.</li>
        <li>Saved insights, dashboards, investigation reports and their evidence (tool results after redaction).</li>
        <li>Native mode only: events and person profiles you send with the SDKs, in your ClickHouse and Postgres.</li>
        <li>An audit log of connections, credential changes, deletions and investigations.</li>
      </ul>
      <h2>Not stored</h2>
      <ul>
        <li>PostHog event data in connect mode, beyond a 60-second in-memory query cache.</li>
        <li>PostHog passwords — HostPog never asks for them.</li>
      </ul>
      <h2>Sent to AI providers</h2>
      <p>Only when someone runs an investigation with a provider an admin configured:</p>
      <ul>
        <li>The question and a fixed system prompt.</li>
        <li>Results of read-only analytics queries (aggregates by default).</li>
        <li>Sample events limited to an allowlist of non-identifying properties (browser, OS, path, release, error code…). Emails and IP-like strings are masked. Admins can allow redacted raw properties per provider.</li>
      </ul>
      <p>Provider terms and retention apply; HostPog makes no claim about a third party&apos;s retention. A local OpenAI-compatible model keeps all of this on your infrastructure.</p>
      <h2>Deletion</h2>
      <ul>
        <li>Disconnect a source: the stored credential is deleted (OAuth tokens are revoked when PostHog supports it). Your PostHog account is not modified.</li>
        <li>Delete stored data: removes a native/demo source&apos;s events and persons from the event store (ClickHouse or Tinybird) and Postgres. Backups follow your own retention.</li>
        <li>Delete project: removes HostPog&apos;s records for it.</li>
      </ul>
      <h2>Telemetry</h2>
      <p>HostPog does not phone home. The marketing pages use no third-party scripts or fonts.</p>
    </DocPage>
  );
}
