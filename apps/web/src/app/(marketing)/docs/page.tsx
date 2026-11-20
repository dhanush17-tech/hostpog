import Link from "next/link";
import { DocPage } from "@/components/prose";

export const metadata = { title: "Docs" };

export default function Docs() {
  return (
    <DocPage title="Documentation" lead="Everything you need to run hostpog and get your data in.">
      <h2>Three ways to use it</h2>
      <table>
        <thead>
          <tr>
            <th>Mode</th>
            <th>What happens</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Connect</td>
            <td>Query your existing PostHog project read-only. No SDK change, nothing copied.</td>
          </tr>
          <tr>
            <td>Native</td>
            <td>
              <code>@hostpog/js</code> and <code>@hostpog/node</code> send events to your own ClickHouse.
            </td>
          </tr>
          <tr>
            <td>Migrate</td>
            <td>Import a PostHog batch export, reconcile counts, then cut over.</td>
          </tr>
        </tbody>
      </table>
      <h2>Concepts</h2>
      <ul>
        <li>
          <strong>Source</strong> — where a project&apos;s data comes from: a PostHog project, the native SDK, or sample data. Each query uses one source.
        </li>
        <li>
          <strong>Query</strong> — every chart links to the exact HogQL or ClickHouse SQL behind it.
        </li>
        <li>
          <strong>Investigation</strong> — ask why a metric moved and get a report with the queries that back it up. Uses your own model key.
        </li>
      </ul>
      <h2>Start here</h2>
      <ul>
        <li>
          <Link href="/docs/self-host">Run HostPog on your machine</Link>
        </li>
        <li>
          <Link href="/docs/posthog">Connect an existing PostHog project</Link>
        </li>
        <li>
          <Link href="/docs/sdk">Collect events with the SDKs</Link>
        </li>
      </ul>
    </DocPage>
  );
}
