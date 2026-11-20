import { DocPage } from "@/components/prose";

export const metadata = { title: "Connecting PostHog" };

export default function PostHogDocs() {
  return (
    <DocPage title="Connecting PostHog" lead="Read-only, federated access through PostHog's documented private API. Nothing is copied and nothing in PostHog is changed.">
      <h2>What HostPog uses</h2>
      <table>
        <thead>
          <tr>
            <th>Endpoint</th>
            <th>Scope</th>
            <th>Why</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>
              <code>GET /api/users/@me/</code>
            </td>
            <td>
              <code>user:read</code>
            </td>
            <td>find organizations</td>
          </tr>
          <tr>
            <td>
              <code>GET /api/organizations/:id/projects/</code>
            </td>
            <td>
              <code>project:read</code>
            </td>
            <td>list projects + timezone</td>
          </tr>
          <tr>
            <td>
              <code>POST /api/projects/:id/query/</code>
            </td>
            <td>
              <code>query:read</code>
            </td>
            <td>bounded HogQL queries (required)</td>
          </tr>
          <tr>
            <td>
              <code>GET /api/projects/:id/event_definitions/</code>
            </td>
            <td>
              <code>event_definition:read</code>
            </td>
            <td>event autocomplete</td>
          </tr>
          <tr>
            <td>
              <code>session_recordings</code>, <code>insights</code> (probe only)
            </td>
            <td>
              <code>session_recording:read</code>, <code>insight:read</code>
            </td>
            <td>optional: recording links, saved insights</td>
          </tr>
        </tbody>
      </table>
      <p>Hosts: <code>https://us.posthog.com</code>, <code>https://eu.posthog.com</code>, or an operator-approved self-hosted origin. Public capture hosts are never used.</p>
      <h2>Personal API key (default)</h2>
      <ol>
        <li>PostHog → Settings → Personal API keys → Create key.</li>
        <li>Restrict it to the project and grant read scopes only (list above).</li>
        <li>Paste it into HostPog. It is validated, scope-probed, encrypted with AES-256-GCM and never displayed again.</li>
      </ol>
      <h2>OAuth</h2>
      <p>
        PostHog registers OAuth clients with a Client ID Metadata Document: the client ID is an HTTPS URL on your domain. HostPog serves it at <code>/oauth/posthog-client.json</code> and uses authorization code + PKCE (S256), single-use
        state, exact redirect URIs, token refresh and revocation on disconnect. It only works when HostPog is reachable over public HTTPS and <code>HOSTPOG_POSTHOG_OAUTH_ENABLED=true</code>. Unverified apps show an
        &quot;unverified application&quot; notice in PostHog until verification.
      </p>
      <h2>Limits and freshness</h2>
      <ul>
        <li>PostHog documents 2,400 query requests/hour and 240/minute per key, a 10-second execution limit and 3 concurrent queries per project. HostPog budgets itself to 80% of that by default and honours <code>Retry-After</code>.</li>
        <li>Results are cached per tenant, source, credential and query fingerprint for 60 s; PostHog&apos;s own cache state is shown as &quot;cached / data as of&quot;.</li>
        <li>HostPog never pages the query endpoint to dump events. Event lists use keyset pagination and small limits.</li>
      </ul>
      <h2>What is not available in connect mode</h2>
      <ul>
        <li>Embedded session replay. HostPog shows sessions and links to the recording in PostHog, where PostHog checks access.</li>
        <li>Your existing PostHog feature flags and surveys stay in PostHog. HostPog&apos;s own flags, experiments and surveys are served to posthog-js once the SDK points at HostPog&apos;s <code>/ph</code> endpoint; while PostHog still runs in parallel, both sets are merged in one response, HostPog&apos;s winning on a key clash.</li>
        <li>Error tracking: not built yet.</li>
      </ul>
      <h2>Verify against your own project</h2>
      <pre>
        <code>{`POSTHOG_SMOKE_API_KEY=phx_... POSTHOG_SMOKE_REGION=us pnpm posthog:smoke`}</code>
      </pre>
      <p>Read-only. Prints discovered projects, which scopes work and the result counts of one summary, trend, funnel, events, persons and web query.</p>
      <h2>Migrating off PostHog</h2>
      <p>Open <strong>Migrate from PostHog</strong> in the app: import a batch export, check the counts match, then switch your SDK. Your PostHog capture keeps running until you cut over.</p>
    </DocPage>
  );
}
