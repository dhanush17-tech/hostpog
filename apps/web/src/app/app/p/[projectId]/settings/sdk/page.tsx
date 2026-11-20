"use client";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useProject } from "@/components/project-context";
import { SdkSnippets } from "@/components/snippets";
import { Button, Empty, ErrorBox, Field, PageHeader, Section } from "@/components/ui";
import { apiSend } from "@/lib/api";

export default function SdkSettings() {
  const p = useProject();
  const qc = useQueryClient();
  const native = p.sources.find((s) => s.kind === "native");
  const key = native?.ingestionKeys[0];
  const [origins, setOrigins] = useState<string>(key?.allowedOrigins.join("\n") ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const ingestUrl = process.env.NEXT_PUBLIC_HOSTPOG_INGEST_URL ?? "http://localhost:3001";
  const refresh = () => qc.invalidateQueries({ queryKey: ["sources", p.projectId] });

  return (
    <div className="mx-auto max-w-[1000px]">
      <PageHeader title="SDK" description="Send events straight to hostpog from your app." />
      {!native ? (
        <Empty
          title="Native collection is not set up"
          action={
            p.can("admin") && (
              <Button
                variant="primary"
                onClick={async () => {
                  try {
                    await apiSend(`/api/v1/projects/${p.projectId}/native`, "POST", {});
                    await refresh();
                  } catch (e) {
                    setErr((e as Error).message);
                  }
                }}
              >
                Create a project key
              </Button>
            )
          }
        >
          You do not need this if you only connect PostHog.
        </Empty>
      ) : (
        <div className="space-y-5">
          <Section title="Project key">
            <div className="space-y-3 p-4">
              <p className="text-[13px] text-ink-2">Write-only key — safe to use in client-side code.</p>
              {key ? <code className="block font-mono text-[13px]">{key.publicKey}</code> : <p className="text-[13px] text-neg">No active key.</p>}
              {p.can("admin") && (
                <Button
                  size="sm"
                  onClick={async () => {
                    if (!confirm("Rotate the key? The old key stops working immediately.")) return;
                    await apiSend(`/api/v1/projects/${p.projectId}/sources/${native.id}`, "POST", { action: "rotate_ingestion_key" });
                    await refresh();
                  }}
                >
                  Rotate key
                </Button>
              )}
            </div>
          </Section>
          {key && (
            <Section title="Install">
              <div className="p-4">
                <SdkSnippets publicKey={key.publicKey} ingestUrl={ingestUrl} />
              </div>
            </Section>
          )}
          {p.can("admin") && key && (
            <Section title="Allowed origins (browser)">
              <form
                className="space-y-2 p-4"
                onSubmit={async (e) => {
                  e.preventDefault();
                  setErr(null);
                  try {
                    await apiSend(`/api/v1/projects/${p.projectId}/sources/${native.id}`, "POST", { action: "set_allowed_origins", origins: origins.split(/\s+/).filter(Boolean) });
                    setMsg("Saved.");
                    await refresh();
                  } catch (e2) {
                    setErr((e2 as Error).message);
                  }
                }}
              >
                <Field label="One origin per line" hint="Empty = any origin. Server SDKs without an Origin header are always allowed.">
                  {(id) => <textarea id={id} rows={3} className="w-full rounded-md border border-line bg-panel p-2 font-mono text-[12px]" placeholder="https://app.example.com" value={origins} onChange={(e) => setOrigins(e.target.value)} />}
                </Field>
                <Button size="sm" type="submit">
                  Save origins
                </Button>
                {msg && <span className="ml-2 text-[12px] text-pos">{msg}</span>}
              </form>
            </Section>
          )}
        </div>
      )}
      {err && <ErrorBox error={err} />}
    </div>
  );
}
