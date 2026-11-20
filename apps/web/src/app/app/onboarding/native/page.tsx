"use client";
import type { EventsResult } from "@hostpog/contracts";
import { CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { SdkSnippets } from "@/components/snippets";
import { Button, ErrorBox, Spinner } from "@/components/ui";
import { apiSend, useAnalytics } from "@/lib/api";
import { fmtTime } from "@/lib/format";

export default function NativeOnboarding() {
  const sp = useSearchParams();
  const projectId = sp.get("project") ?? "";
  const [setup, setSetup] = useState<{ source: { id: string }; publicKey: string; ingestUrl: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) return;
    apiSend<typeof setup>(`/api/v1/projects/${projectId}/native`, "POST", {})
      .then(setSetup)
      .catch((e) => setError(e.message));
  }, [projectId]);

  const events = useAnalytics(projectId, setup?.source.id ?? null, setup ? { kind: "events", dateRange: { from: "-24h", to: "now" }, limit: 5, filters: [] } : null, {
    refetchInterval: (q) => ((q.state.data?.result as EventsResult | undefined)?.rows.length ? false : 3000),
    staleTime: 0,
  });
  const first = (events.data?.result as EventsResult | undefined)?.rows[0];

  return (
    <div>
      <Link href={`/app/onboarding?project=${projectId}`} className="text-[13px] text-ink-3 hover:text-ink">
        ← Back
      </Link>
      <h1 className="mt-2 text-[28px] font-semibold tracking-tight">Start collecting data</h1>
      <p className="mt-1 text-[14px] text-ink-2">Install the HostPog SDK. Events go to your own ClickHouse; no PostHog account needed.</p>
      {error && (
        <div className="mt-6">
          <ErrorBox error={error} />
        </div>
      )}
      {!setup && !error && (
        <div className="mt-6">
          <Spinner label="Creating a write-only project key…" />
        </div>
      )}
      {setup && (
        <div className="mt-8 space-y-6">
          <div>
            <p className="text-[12px] font-medium text-ink-2">Project key (write-only — safe to ship in client code)</p>
            <code className="mt-1 block font-mono text-[13px]">{setup.publicKey}</code>
          </div>
          <SdkSnippets publicKey={setup.publicKey} ingestUrl={setup.ingestUrl} />
          <div className="rounded-lg border border-line bg-panel p-4" aria-live="polite">
            {first ? (
              <div>
                <p className="inline-flex items-center gap-2 text-[14px] font-medium text-pos">
                  <CheckCircle2 size={16} /> First event received
                </p>
                <p className="mt-1 text-[13px] text-ink-2">
                  <code className="font-mono">{first.event}</code> from <code className="font-mono">{first.distinctId}</code> at {fmtTime(first.timestamp)}
                </p>
                <Link href={`/app/p/${projectId}/events?source=${setup.source.id}`}>
                  <Button className="mt-3" variant="primary">
                    Open the event explorer
                  </Button>
                </Link>
              </div>
            ) : (
              <Spinner label="Waiting for your first event… (send one with the curl tab to test)" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
