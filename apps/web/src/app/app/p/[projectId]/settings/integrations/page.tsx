"use client";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, KeyRound, Plus, RefreshCw, Star, Trash2, Unplug, XCircle } from "lucide-react";
import { RowMenu } from "@/components/row-menu";
import Link from "next/link";
import { useState } from "react";
import { useProject, type SourceInfo } from "@/components/project-context";
import { sourceName } from "@/components/shell";
import { Badge, Button, ErrorBox, Input, PageHeader, Section } from "@/components/ui";
import { apiSend } from "@/lib/api";
import { fmtRelative, fmtTime } from "@/lib/format";

const KIND = { posthog: "PostHog (connected, read-only)", native: "HostPog SDK (native)", imported: "Imported", demo: "Demo data (synthetic)" } as const;

function SourceRow({ s, onRemoved }: { s: SourceInfo; onRemoved: (msg: string) => void }) {
  const p = useProject();
  const qc = useQueryClient();
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rotate, setRotate] = useState(false);
  const [newKey, setNewKey] = useState("");
  const cfg = s.config as { region?: string; host?: string; externalProjectName?: string; externalProjectId?: string; scopes?: string[]; timezone?: string; authMethod?: string };
  const act = async (name: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(name);
    setErr(null);
    setMsg(null);
    try {
      await fn();
      if (name === "disconnect") onRemoved(`${s.label}: ${done}`);
      else setMsg(done);
      await qc.invalidateQueries({ queryKey: ["sources", p.projectId] });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const base = `/api/v1/projects/${p.projectId}/sources/${s.id}`;
  const admin = p.can("admin");
  const live = s.status !== "disconnected";
  const check = () => void act("health", () => apiSend(base, "POST", { action: "health" }), "Connection looks good.");
  const disconnect = () =>
    confirm(
      s.kind === "posthog"
        ? "Disconnect PostHog? HostPog deletes its encrypted credential. Nothing changes in your PostHog account."
        : "Disconnect this source? Its ingestion keys stop working. Stored data is kept until you delete it.",
    ) && void act("disconnect", () => apiSend(`${base}?mode=disconnect`, "DELETE"), "Disconnected and credential removed.");
  const deleteData = () =>
    confirm("Permanently delete all events and persons stored for this source? This cannot be undone.") &&
    void act("delete", () => apiSend(`${base}?mode=delete_data`, "DELETE"), "Stored data deleted.");
  return (
    <li className="space-y-3 px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="flex flex-wrap items-center gap-2 text-[14px] font-medium">
            {sourceName(s)}
            {p.primarySourceId === s.id && <Badge tone="brand">default</Badge>}
            {s.status !== "active" && <Badge tone={s.status === "error" ? "neg" : "neutral"}>{s.status}</Badge>}
          </p>
          <p className="text-[12px] text-ink-3">
            {KIND[s.kind]} · {s.lastSuccessAt ? `last request ${fmtRelative(s.lastSuccessAt)}` : "no requests yet"}
          </p>
        </div>
        {admin && live && (
          <div className="flex items-center gap-1.5">
            {/* Only a broken source gets a visible button: the fix. Everything else is in ⋯. */}
            {s.status === "error" && (
              <Button size="sm" loading={busy === "health"} onClick={check}>
                <RefreshCw size={14} /> Check again
              </Button>
            )}
            <RowMenu
              items={[
                { label: "Check connection", icon: <RefreshCw size={14} />, onSelect: check, hidden: s.status === "error" },
                { label: "Make default", icon: <Star size={14} />, onSelect: () => void act("primary", () => apiSend(base, "POST", { action: "make_primary" }), "Now the default source."), hidden: p.primarySourceId === s.id },
                { label: "Replace API key", icon: <KeyRound size={14} />, onSelect: () => setRotate(true), hidden: !(s.kind === "posthog" && cfg.authMethod === "api_key") },
                { label: "Disconnect", icon: <Unplug size={14} />, danger: true, onSelect: disconnect },
                { label: "Delete stored data", icon: <Trash2 size={14} />, danger: true, onSelect: deleteData, hidden: s.kind === "posthog" },
              ]}
            />
          </div>
        )}
        {admin && !live && s.kind !== "posthog" && <RowMenu items={[{ label: "Delete stored data", icon: <Trash2 size={14} />, danger: true, onSelect: deleteData }]} />}
      </div>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-[12px] sm:grid-cols-2">
        {s.kind === "posthog" && (
          <>
            <div className="flex gap-2">
              <dt className="text-ink-3">Region</dt>
              <dd>
                {cfg.region === "us" ? "US Cloud" : cfg.region === "eu" ? "EU Cloud" : `Self-hosted (${cfg.host})`}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-ink-3">PostHog project</dt>
              <dd>
                {cfg.externalProjectName} ({cfg.externalProjectId}) · {cfg.timezone}
              </dd>
            </div>
            <div className="flex gap-2">
              <dt className="text-ink-3">Auth</dt>
              <dd>
                {cfg.authMethod === "oauth" ? "OAuth" : "Personal API key"} {s.credential ? `· ${s.credential.hint} · added ${fmtTime(s.credential.createdAt)}${s.credential.rotatedAt ? ` · rotated ${fmtRelative(s.credential.rotatedAt)}` : ""}` : "· removed"}
              </dd>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <dt className="text-ink-3">Verified scopes</dt>
              {(cfg.scopes ?? []).map((sc) => (
                <dd key={sc}>
                  <Badge>{sc}</Badge>
                </dd>
              ))}
            </div>
          </>
        )}
        {(s.stats.errors > 0 || s.stats.rateLimited > 0) && (
          <div className="flex gap-2">
            <dt className="text-ink-3">Recent requests</dt>
            <dd>
              {s.stats.ok} ok · {s.stats.errors} errors · {s.stats.rateLimited} rate-limited
            </dd>
          </div>
        )}
      </dl>
      {s.lastError && <ErrorBox error={`Last error: ${s.lastError}`} />}
      {rotate && (
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void act("rotate", () => apiSend(base, "POST", { action: "rotate_key", apiKey: newKey.trim() }), "Key rotated and re-verified.").then(() => {
              setNewKey("");
              setRotate(false);
            });
          }}
        >
          <Input aria-label="New personal API key" type="password" autoComplete="off" placeholder="New phx_… key" className="w-[280px]" value={newKey} onChange={(e) => setNewKey(e.target.value)} />
          <Button size="sm" variant="primary" type="submit" loading={busy === "rotate"} disabled={!newKey.trim()}>
            Verify &amp; replace
          </Button>
          <Button size="sm" variant="ghost" type="button" onClick={() => setRotate(false)}>
            Cancel
          </Button>
        </form>
      )}
      {msg && (
        <p className="inline-flex items-center gap-1 text-[12px] text-pos">
          <CheckCircle2 size={14} /> {msg}
        </p>
      )}
      {err && (
        <p className="inline-flex items-center gap-1 text-[12px] text-neg">
          <XCircle size={14} /> {err}
        </p>
      )}
      {s.kind === "posthog" && (
        <p className="text-[12px] text-ink-3">
          Ready to stop paying for PostHog? <Link className="font-medium text-brand-deep underline" href={p.href("migrate")}>Move off PostHog</Link>
        </p>
      )}
    </li>
  );
}

export default function Integrations() {
  const p = useProject();
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <div className="mx-auto max-w-[1100px]">
      <PageHeader
        title="Integrations"
        description="Connect PostHog or send events with the SDK."
        actions={
          p.can("admin") && (
            <Link href={`/app/onboarding?project=${p.projectId}`}>
              <Button variant="primary">
                <Plus size={14} /> Add source
              </Button>
            </Link>
          )
        }
      />
      {notice && (
        <p role="status" className="mb-3 inline-flex items-center gap-1.5 text-[13px] text-pos">
          <CheckCircle2 size={14} /> {notice}
        </p>
      )}
      <Section>
        <ul className="divide-y divide-line">
          {p.sources.map((s) => (
            <SourceRow key={s.id} s={s} onRemoved={setNotice} />
          ))}
          {!p.sources.length && !p.sourcesLoading && <li className="px-4 py-6 text-[13px] text-ink-3">No sources yet.</li>}
        </ul>
      </Section>
    </div>
  );
}
