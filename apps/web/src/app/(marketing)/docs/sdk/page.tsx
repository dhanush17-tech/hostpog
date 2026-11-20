import { DocPage } from "@/components/prose";

export const metadata = { title: "SDKs" };

export default function SdkDocs() {
  return (
    <DocPage title="SDKs" lead="@hostpog/js for browsers and @hostpog/node for servers. Both send to HostPog ingestion with a write-only project key.">
      <p>
        The packages build from this repository (<code>packages/sdk-js</code>, <code>packages/sdk-node</code>). They are not published to npm yet; until then use a workspace dependency or <code>pnpm pack</code>.
      </p>
      <h2>Browser</h2>
      <pre>
        <code>{`import hostpog from "@hostpog/js";

hostpog.init("hp_pk_...", {
  host: "https://ingest.example.com",
  capturePageviews: true,     // default: $pageview on load + SPA navigation
  autocaptureClicks: false,   // default off; never captures input values or text
  optOutByDefault: false,     // set true to wait for consent → hostpog.optIn()
  allowedQueryParams: [],     // query strings are stripped except utm_*
});

hostpog.capture("signed_up", { plan: "free" });
hostpog.identify("user_123", { email: "user@example.com" });
hostpog.reset();      // on logout
hostpog.optOut();     // clears the queue and stops capture
await hostpog.flush();`}</code>
      </pre>
      <ul>
        <li>Events are batched (20 or every 3 s), queued in localStorage (max 500) and flushed with sendBeacon when the page is hidden.</li>
        <li>Retries with exponential backoff on network errors, 429 and 5xx; other 4xx responses are dropped.</li>
        <li>Each event has a UUID; the server de-duplicates retries.</li>
        <li>
          Elements inside <code>[data-hp-no-capture]</code> (or your <code>blockSelector</code>) are never autocaptured.
        </li>
      </ul>
      <h2>Node</h2>
      <pre>
        <code>{`import { HostPogNode } from "@hostpog/node";

const hostpog = new HostPogNode("hp_pk_...", { host: "https://ingest.example.com" });
hostpog.capture({ distinctId: "user_123", event: "invoice_paid", properties: { amount: 20 } });
hostpog.identify({ distinctId: "user_123", anonymousId: "anon-abc", properties: { plan: "team" } });
hostpog.captureException(err, "user_123");   // $exception with a stable fingerprint
await hostpog.shutdown();`}</code>
      </pre>
      <h2>HTTP API</h2>
      <pre>
        <code>{`POST /v1/batch    { "api_key": "hp_pk_...", "batch": [ { "uuid", "event", "distinct_id", "timestamp?", "properties?" } ] }
POST /v1/capture  (single event; key in Authorization: Bearer hp_pk_...)`}</code>
      </pre>
      <ul>
        <li>Limits: 1 MB per request, 500 events per batch, 64 KB per event, rate limit per key (default 1,200/min).</li>
        <li>
          200 means durably written. The response lists <code>accepted</code>, <code>duplicates</code> and per-event <code>rejected</code> reasons.
        </li>
        <li>
          <code>$identify</code> with <code>$anon_distinct_id</code> merges an anonymous person into an identified one. Two identified persons are never merged.
        </li>
        <li>Property names that look like secrets (password, token, api_key, card number…) are dropped server-side; sensitive query parameters in URLs are redacted.</li>
      </ul>
      <p>The SDKs are not drop-in replacements for posthog-js or posthog-node, although they use the same property conventions ($pageview, $current_url, $pathname, $session_id).</p>
    </DocPage>
  );
}
