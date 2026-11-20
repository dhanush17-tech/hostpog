"use client";
import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { CopyButton } from "./docs/copy-button";
import { Segmented } from "./ui";

export function CopyBlock({ code, label }: { code: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <pre aria-label={label} className="overflow-auto rounded-md border border-line bg-panel-2 p-3 pr-12 font-mono text-[12px] leading-5">
        {code}
      </pre>
      <button
        className="absolute right-2 top-2 inline-flex h-7 w-7 items-center justify-center rounded-md border border-line bg-panel text-ink-2 hover:text-ink"
        aria-label={`Copy ${label}`}
        onClick={async () => {
          await navigator.clipboard.writeText(code);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? <Check size={14} /> : <Copy size={14} />}
      </button>
    </div>
  );
}

export function SdkSnippets({ publicKey, ingestUrl }: { publicKey: string; ingestUrl: string }) {
  const [tab, setTab] = useState<"js" | "next" | "node" | "curl">("js");
  const snippets = {
    js: `// npm install @hostpog/js
import hostpog from "@hostpog/js";

hostpog.init("${publicKey}", {
  host: "${ingestUrl}",
  capturePageviews: true,      // $pageview on load + SPA navigation
  autocaptureClicks: false,    // opt in explicitly
});

hostpog.capture("signed_up", { plan: "free" });
hostpog.identify(user.id, { email: user.email }); // after login
hostpog.reset();                                   // on logout`,
    next: `// app/hostpog-provider.tsx
"use client";
import { useEffect } from "react";
import hostpog from "@hostpog/js";

export function HostPogProvider({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    hostpog.init("${publicKey}", { host: "${ingestUrl}" });
  }, []);
  return children;
}
// wrap <body> children in app/layout.tsx with <HostPogProvider>`,
    node: `// npm install @hostpog/node
import { HostPogNode } from "@hostpog/node";

const hostpog = new HostPogNode("${publicKey}", { host: "${ingestUrl}" });

hostpog.capture({ distinctId: user.id, event: "invoice_paid", properties: { amount: 20 } });
hostpog.captureException(err, user.id);
await hostpog.shutdown(); // flush before exit`,
    curl: `curl -X POST ${ingestUrl}/v1/capture \\
  -H "Authorization: Bearer ${publicKey}" \\
  -H "Content-Type: application/json" \\
  -d '{"uuid":"'"$(uuidgen | tr A-Z a-z)"'","event":"test_event","distinct_id":"test-user","properties":{"source":"curl"}}'`,
  };
  const agentPrompt = `Add hostpog product analytics to this codebase.

Project key (write-only, safe in client code): ${publicKey}
Ingest host: ${ingestUrl}

1. Look at the project first: framework (Next.js, React, Vue, plain JS, Node backend…), package manager, and where app-wide setup lives. Tell me what you found before changing anything.
2. Install @hostpog/js for the browser app (and @hostpog/node if there's a Node backend) with the project's package manager.
3. Put the key and host in environment variables (e.g. NEXT_PUBLIC_HOSTPOG_KEY / NEXT_PUBLIC_HOSTPOG_HOST, or the framework's equivalent) and add them to the example env file. Don't hardcode them.
4. Initialise once on the client at app start-up:
   hostpog.init(KEY, { host: HOST, capturePageviews: true, autocaptureClicks: false })
   For Next.js App Router, use a small "use client" provider component wrapped around the app in the root layout.
5. Call hostpog.identify(user.id, { email }) right after login/signup and hostpog.reset() on logout, using the app's existing auth code.
6. Suggest 3–5 key product events (e.g. signed_up, onboarding_completed, the main "aha" action, upgraded) based on what this app does. Show me the list and wait for my OK before adding capture calls.
7. Don't send passwords, tokens or full request bodies as properties.
8. Run the app, trigger a pageview and one event, and tell me to check they appear on the hostpog Events page. Then summarise every file you changed.`;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
      <Segmented
        label="Snippet language"
        value={tab}
        onChange={setTab}
        options={[
          { value: "js", label: "JavaScript" },
          { value: "next", label: "React / Next.js" },
          { value: "node", label: "Node" },
          { value: "curl", label: "curl" },
        ]}
      />
        <CopyButton text={agentPrompt} label="Copy prompt for your coding agent" className="border-transparent bg-primary !text-white hover:bg-primary/90" />
      </div>
      <p className="text-[12px] text-ink-3">Paste it into Claude Code, Codex or Cursor in your app&apos;s repo — it installs the SDK, wires up identify/reset and asks before adding events.</p>
      <CopyBlock code={snippets[tab]} label={`${tab} snippet`} />
    </div>
  );
}
