"use client";
import type { ProductUsageReport } from "@hostpog/db";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bot, Check, CheckCircle2, ChevronDown, Copy, Loader2, Upload } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useProject } from "@/components/project-context";
import { Badge, Button, cx, Empty, ErrorBox, Select, Spinner } from "@/components/ui";
import { apiGet, apiSend } from "@/lib/api";
import { fmtInt, fmtRelative } from "@/lib/format";

interface Job {
  id: string;
  method: "api" | "file" | "s3";
  status: string;
  phase: string;
  estimatedRows: number | null;
  importedEvents: number;
  importedPersons: number;
  duplicateEvents: number;
  failedRows: number;
  config: Record<string, unknown>;
  error: string | null;
  createdAt: string;
  running: boolean;
}
interface MigrationState {
  migration: null | {
    posthogProjectToken: string | null;
    captureHost: string;
    forwarding: boolean;
    productUsage: ProductUsageReport | null;
    trackingLastSeenAt: string | null;
    capturedViaProxy: number;
    forwardedRequests: number;
    forwardFailures: number;
    lastForwardError: string | null;
    acknowledgedGaps: string[];
    status: "in_progress" | "cut_over" | "rolled_back";
    cutoverAt: string | null;
  };
  posthog: { label: string; region: string } | null;
  ingestUrl: string;
  uiHost?: string;
  jobs?: Job[];
  checklist?: { key: string; label: string; done: boolean; detail: string }[];
}
interface Reconcile {
  timezone: string;
  days: { day: string; posthog: { events: number; users: number }; hostpog: { events: number; users: number }; eventDiffPct: number | null; status: string }[];
  summary: { checkedDays: number; mismatchedDays: number; posthogEvents: number; hostpogEvents: number; tolerance: string };
}

/* ---------- small pieces ---------- */

function CopyButton({ text, children, variant = "secondary" }: { text: string; children: ReactNode; variant?: "primary" | "secondary" }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant={variant}
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1800);
      }}
    >
      {done ? <Check size={14} /> : <Copy size={14} />}
      {done ? "Copied" : children}
    </Button>
  );
}

function More({ label, children, open }: { label: string; children: ReactNode; open?: boolean }) {
  return (
    <details className="group rounded-md border border-line" open={open}>
      <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-[13px] text-ink-2 hover:text-ink">
        {label}
        <ChevronDown size={14} className="transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-2 border-t border-line px-3 py-3 text-[13px] text-ink-2">{children}</div>
    </details>
  );
}

const fmtDay = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * Explains a reconciliation mismatch in plain terms and offers the fix as one button:
 * which days, why (by direction), and "copy the missing events" which re-imports just that window
 * (already-copied events are skipped by uuid) and re-checks automatically.
 */
function MismatchNote({
  rec,
  lastCopy,
  onFill,
  filling,
  onGoToTracking,
}: {
  rec: Reconcile;
  lastCopy: string | null;
  onFill: ((fromDay: string) => void) | null;
  filling: { copied: number } | null;
  onGoToTracking: () => void;
}) {
  const bad = rec.days.filter((d) => d.status === "mismatch");
  const missing = bad.filter((d) => d.hostpog.events < d.posthog.events);
  const extra = bad.filter((d) => d.hostpog.events > d.posthog.events);
  const missingTotal = missing.reduce((a, d) => a + d.posthog.events - d.hostpog.events, 0);
  const today = rec.days.find((d) => d.status === "partial_day");
  const days = (xs: typeof bad) => xs.map((d) => fmtDay(d.day)).join(", ");
  return (
    <div className="space-y-3 rounded-lg border border-warn/30 bg-warn/10 px-4 py-3.5">
      {missing.length > 0 && (
        <div className="space-y-2">
          <p className="font-medium text-ink">
            {fmtInt(missingTotal)} {missingTotal === 1 ? "event is" : "events are"} missing from {days(missing)}
          </p>
          <p className="text-[13px] text-ink-2">
            PostHog received {missingTotal === 1 ? "it" : "them"} after you copied your history{lastCopy ? ` ${fmtRelative(lastCopy)}` : ""} and before your app started sending to HostPog, so
            {missingTotal === 1 ? " it" : " they"} only exist in PostHog. Copy them over and we&apos;ll check again automatically — nothing gets counted twice.
          </p>
          {onFill &&
            (filling ? (
              <p className="inline-flex items-center gap-2 text-[13px] text-ink-2">
                <Loader2 size={14} className="animate-spin" aria-hidden /> Copying missing events… {fmtInt(filling.copied)} copied so far
              </p>
            ) : (
              <Button variant="primary" onClick={() => onFill(missing[0]!.day)}>
                Copy the missing events
              </Button>
            ))}
        </div>
      )}
      {extra.length > 0 && (
        <div className="space-y-2">
          <p className="font-medium text-ink">
            HostPog has more events than PostHog on {days(extra)}
          </p>
          <p className="text-[13px] text-ink-2">Some events reached HostPog but not PostHog — usually because forwarding failed or was off for a while. Check that forwarding is healthy in step 2.</p>
          <Button onClick={onGoToTracking}>Check forwarding</Button>
        </div>
      )}
      {today && today.hostpog.events !== today.posthog.events && (
        <p className="text-[12px] text-ink-3">
          Today ({fmtInt(today.posthog.events)} in PostHog, {fmtInt(today.hostpog.events)} in HostPog) isn&apos;t checked until it&apos;s over. Copying the missing events covers today too.
        </p>
      )}
    </div>
  );
}

function Diff({ lines }: { lines: { t: " " | "-" | "+"; s: string }[] }) {
  return (
    <pre className="overflow-auto rounded-md border border-line bg-panel-2 py-2 font-mono text-[12px] leading-6">
      {lines.map((l, i) => (
        <div key={i} className={cx("px-3", l.t === "-" && "bg-neg/10 text-neg line-through decoration-neg/40", l.t === "+" && "bg-pos/10 text-pos")}>
          <span className="mr-2 inline-block w-3 select-none opacity-60">{l.t === " " ? "" : l.t}</span>
          {l.s}
        </div>
      ))}
    </pre>
  );
}

function agentPrompt(token: string, newHost: string, oldHost: string, uiHost: string) {
  return `Move this codebase's PostHog analytics to HostPog by changing only the host PostHog sends events to.

Find every place PostHog is initialised (posthog-js / posthog.init, PostHogProvider options, posthog-node, posthog-python, posthog-react-native, any other PostHog SDK, plus env vars and reverse-proxy rewrites that point at PostHog).

For each one:
- Set the API host to: ${newHost}
  (it is currently ${oldHost} or a proxy in front of it)
- For posthog-js, also set ui_host: "${uiHost}" so toolbar links still open PostHog.
- Keep the project token unchanged: ${token}
- If the host comes from an environment variable, change the variable's value in .env.example / config and tell me which deployed env vars I need to update; do not commit real secrets.
- If there is a Next.js/Vercel/Nginx rewrite proxying /ingest (or similar) to PostHog, point that rewrite at ${newHost} instead of changing the SDK.

Do not change event names, properties, identify calls, feature-flag code or anything else.

When done, list every file you changed and the exact before/after line, and tell me how to verify: load the app, then check that HostPog's "Move off PostHog" page shows "Receiving events".`;
}

/* ---------- page ---------- */

const STEPS = [
  { key: "review", title: "See what moves over" },
  { key: "track", title: "Point your app at HostPog" },
  { key: "history", title: "Copy your history" },
  { key: "compare", title: "Compare the numbers" },
  { key: "switch", title: "Switch off PostHog" },
] as const;
type StepKey = (typeof STEPS)[number]["key"];

export default function Migrate() {
  const p = useProject();
  const qc = useQueryClient();
  const sp = useSearchParams();
  const key = ["migration", p.projectId];
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [rangeDays, setRangeDays] = useState("365");
  const [rec, setRec] = useState<Reconcile | null>(null);
  const [gapJob, setGapJob] = useState<string | null>(null);
  const [override, setOverride] = useState(false);
  const [step, setStep] = useState<StepKey | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const autoStarted = useRef(false);
  const autoChecked = useRef(false);
  const autoCompared = useRef(false);

  const q = useQuery({
    queryKey: key,
    queryFn: () => apiGet<MigrationState>(`/api/v1/projects/${p.projectId}/migration`),
    refetchInterval: (s) => (s.state.data?.jobs?.some((j) => j.running) || (s.state.data?.migration && !s.state.data.migration.trackingLastSeenAt) ? 4000 : 15000),
  });
  const act = async (name: string, fn: () => Promise<unknown>) => {
    setBusy(name);
    setErr(null);
    try {
      await fn();
      await qc.invalidateQueries({ queryKey: key });
      await qc.invalidateQueries({ queryKey: ["sources", p.projectId] });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(null);
    }
  };
  const post = (body: unknown) => apiSend(`/api/v1/projects/${p.projectId}/migration`, "POST", body);
  const admin = p.can("admin");
  const s = q.data;
  const m = s?.migration;

  // Arriving from "Move off PostHog" starts the migration straight away.
  useEffect(() => {
    if (s && !m && s.posthog && admin && sp.get("start") === "1" && !autoStarted.current) {
      autoStarted.current = true;
      void act("setup", () => post({ action: "setup" }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, m, admin]);
  // The product check is read-only and quick: run it as soon as the migration exists.
  useEffect(() => {
    if (m && !m.productUsage && admin && !autoChecked.current) {
      autoChecked.current = true;
      void act("check", () => post({ action: "check_products" }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [m, admin]);

  const usage = m?.productUsage;
  const inUse = (usage?.products ?? []).filter((x) => x.inUse !== false && x.key !== "saved_insights");
  const losing = inUse.filter((x) => x.blocksCutover);
  const jobs = s?.jobs ?? [];
  const latest = jobs[0];
  const done: Record<StepKey, boolean> = {
    review: Boolean(usage) && losing.every((b) => m!.acknowledgedGaps.includes(b.key)),
    track: Boolean(m?.trackingLastSeenAt),
    history: jobs.some((j) => j.status === "complete"),
    compare: Boolean(rec && rec.summary.mismatchedDays === 0 && rec.summary.checkedDays > 0) || Boolean(s?.checklist?.find((c) => c.key === "reconciled")?.done),
    switch: m?.status === "cut_over",
  };
  // The status endpoint doesn't re-count on every poll, so the "counts match" item reflects the latest comparison run here.
  const checklistItems = (s?.checklist ?? []).map((c) =>
    c.key === "reconciled" && rec
      ? {
          ...c,
          done: done.compare,
          detail: busy === "rec" ? "checking…" : rec.summary.checkedDays === 0 ? "no finished days to compare yet" : `${rec.summary.mismatchedDays} ${rec.summary.mismatchedDays === 1 ? "day differs" : "days differ"} — see step 4`,
        }
      : c.key === "reconciled" && !c.done
        ? { ...c, detail: busy === "rec" ? "checking…" : "compare the numbers in step 4" }
        : c,
  );
  const firstOpen = STEPS.find((x) => !done[x.key])?.key ?? "switch";
  const current: StepKey = step ?? firstOpen;
  const idx = STEPS.findIndex((x) => x.key === current);

  useEffect(() => {
    if ((current === "compare" || current === "switch") && m && !rec && !autoCompared.current) {
      autoCompared.current = true;
      void act("rec", async () => setRec(await apiGet<Reconcile>(`/api/v1/projects/${p.projectId}/migration/reconcile?days=14`)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, m]);

  const gap = gapJob ? jobs.find((j) => j.id === gapJob) : undefined;
  useEffect(() => {
    if (gapJob && gap && !gap.running) {
      setGapJob(null);
      void act("rec", async () => setRec(await apiGet<Reconcile>(`/api/v1/projects/${p.projectId}/migration/reconcile?days=14`)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gapJob, gap?.running]);

  if (q.isLoading) return <Spinner />;
  if (q.error) return <ErrorBox error={q.error} />;

  if (!s!.posthog && !m)
    return (
      <div className="mx-auto max-w-[720px] pt-6">
        <Empty title="Connect PostHog first" action={<Link className="text-[13px] font-medium text-brand-deep hover:underline" href={`/app/onboarding/posthog?project=${p.projectId}`}>Connect PostHog</Link>}>
          Moving starts from a read-only connection to your PostHog project.
        </Empty>
      </div>
    );

  const host = s!.ingestUrl.replace(/\/$/, "");
  const token = m?.posthogProjectToken ?? "phc_…";
  const oldHost = m?.captureHost ?? "https://us.i.posthog.com";
  const uiHost = s!.uiHost ?? "https://us.posthog.com";

  /* ----- intro, before the migration exists ----- */
  if (!m)
    return (
      <div className="mx-auto max-w-[640px] pt-6">
        <h1 className="text-[26px] font-semibold tracking-tight">Move off PostHog</h1>
        <p className="mt-2 text-[14px] leading-6 text-ink-2">
          Keep your PostHog code, send your events to HostPog instead, and bring your history with you. Nothing changes for your users until the last step, and you can undo it until you cancel
          PostHog.
        </p>
        <ol className="mt-6 space-y-2 text-[14px]">
          {STEPS.map((x, i) => (
            <li key={x.key} className="flex items-center gap-3">
              <span className="flex h-6 w-6 items-center justify-center rounded-full border border-line text-[12px] text-ink-2">{i + 1}</span>
              {x.title}
            </li>
          ))}
        </ol>
        {err && <div className="mt-4"><ErrorBox error={err} /></div>}
        {admin ? (
          <Button className="mt-6" variant="primary" loading={busy === "setup"} onClick={() => act("setup", () => post({ action: "setup" }))}>
            Start moving {s!.posthog?.label ? `“${s!.posthog.label}”` : ""}
          </Button>
        ) : (
          <p className="mt-6 text-[13px] text-ink-3">Ask a workspace admin to start the move.</p>
        )}
      </div>
    );

  /* ----- step bodies ----- */
  const body: Record<StepKey, ReactNode> = {
    review: !usage ? (
      <Spinner label="Looking at what your PostHog project uses…" />
    ) : (
      <>
        <p>
          You use <strong className="text-ink">{inUse.map((x) => x.label.replace(/ \(.*\)$/, "")).join(", ") || "nothing yet"}</strong> in {s!.posthog?.label ?? "PostHog"}.
        </p>
        <ul className="space-y-1.5">
          {inUse
            .filter((x) => !x.blocksCutover)
            .map((x) => (
              <li key={x.key} className="flex gap-2">
                <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-pos" />
                <span>
                  <span className="text-ink">{x.label.replace(/ \(.*\)$/, "")}</span> moves over. <span className="text-ink-3">{x.detail}</span>
                </span>
              </li>
            ))}
          {(usage.products.find((x) => x.key === "saved_insights")?.inUse ?? false) && (
            <li className="flex gap-2">
              <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-ink-3" />
              <span>
                <span className="text-ink">Saved insights and dashboards</span> need rebuilding in HostPog. <span className="text-ink-3">{usage.products.find((x) => x.key === "saved_insights")?.detail}</span>
              </span>
            </li>
          )}
        </ul>
        {losing.length > 0 && (
          <div className="rounded-md border border-warn/40 bg-warn/5 p-3">
            <p className="font-medium text-ink">Not in HostPog yet</p>
            <p className="mt-0.5">These stop working when you switch off PostHog. Tick each one to confirm you are fine without it.</p>
            <ul className="mt-2 space-y-1.5">
              {losing.map((x) => (
                <li key={x.key}>
                  <label className="flex items-start gap-2">
                    <input className="mt-1" type="checkbox" disabled={!admin} checked={m.acknowledgedGaps.includes(x.key)} onChange={(e) => act("ack", () => post({ action: "acknowledge_gap", key: x.key, value: e.target.checked }))} />
                    <span>
                      <span className="text-ink">{x.label}</span> <span className="text-ink-3">· {x.detail}</span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}
        <More label="Everything we checked">
          <ul className="space-y-1">
            {usage.products.map((x) => (
              <li key={x.key} className="flex justify-between gap-4">
                <span>{x.label}</span>
                <span className="shrink-0 text-ink-3">{x.inUse === null ? "couldn't tell" : x.inUse ? "in use" : "not used"}</span>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between pt-1">
            <span className="text-[12px] text-ink-3">Checked {fmtRelative(usage.checkedAt)}. Read-only.</span>
            {admin && <Button size="sm" variant="ghost" loading={busy === "check"} onClick={() => act("check", () => post({ action: "check_products" }))}>Check again</Button>}
          </div>
        </More>
      </>
    ),

    track: (
      <>
        <p>Change one line where you set up PostHog. Keep the PostHog library, your token and everything else.</p>
        <Diff
          lines={[
            { t: " ", s: `posthog.init("${token}", {` },
            { t: "-", s: `  api_host: "${oldHost}",` },
            { t: "+", s: `  api_host: "${host}/ph",` },
            { t: "+", s: `  ui_host: "${uiHost}",` },
            { t: " ", s: "})" },
          ]}
        />
        <div className="flex flex-wrap gap-2">
          <CopyButton variant="primary" text={`api_host: "${host}/ph",\nui_host: "${uiHost}",`}>Copy the new lines</CopyButton>
          <CopyButton text={agentPrompt(token, `${host}/ph`, oldHost, uiHost)}>
            <Bot size={14} /> Copy prompt for your coding agent
          </CopyButton>
        </div>
        <div className={cx("flex items-center gap-2 rounded-md px-3 py-2.5", m.trackingLastSeenAt ? "bg-pos/10 text-pos" : "bg-panel-2 text-ink-2")}>
          {m.trackingLastSeenAt ? (
            <>
              <CheckCircle2 size={16} /> Receiving events · last one {fmtRelative(m.trackingLastSeenAt)} · {fmtInt(m.capturedViaProxy)} so far
            </>
          ) : (
            <>
              <span className="relative flex h-2.5 w-2.5">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-brand opacity-60 motion-reduce:animate-none" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-brand" />
              </span>
              Deploy the change, then open your app. This turns green when the first event arrives.
            </>
          )}
        </div>
        <More label="Using posthog-node, Python or another server SDK?">
          <p>Change only the host option:</p>
          <pre className="overflow-auto rounded-md bg-panel-2 p-2 font-mono text-[12px]">{`new PostHog("${token}", { host: "${host}/ph" })`}</pre>
        </More>
        <More label="How this keeps PostHog working meanwhile">
          <p>
            Until you switch off PostHog, HostPog stores each event and also passes an exact copy on to PostHog, along with feature flag and recording requests. Your users and your PostHog
            dashboards see no difference.
          </p>
          {host.includes("localhost") && <p className="text-warn">{host} is only reachable from this computer. Use your public HostPog address for a live site.</p>}
          <p className="text-ink-3">
            {fmtInt(m.forwardedRequests)} requests passed on to PostHog{m.forwardFailures ? `, ${fmtInt(m.forwardFailures)} failed` : ""}.{m.lastForwardError ? ` Last error: ${m.lastForwardError}` : ""}
          </p>
          {admin && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={m.forwarding} onChange={(e) => act("fwd", () => post({ action: "set_forwarding", value: e.target.checked }))} />
              Keep copying events to PostHog
            </label>
          )}
        </More>
      </>
    ),

    history: (
      <>
        <p>Copy your past events from PostHog so your charts in HostPog go back as far as they do today. Running it twice never creates duplicates.</p>
        {latest && (
          <div className="rounded-md border border-line p-3">
            {latest.running ? (
              <>
                <div className="flex justify-between">
                  <span className="text-ink">Copying {latest.phase === "persons" ? "people" : "events"}…</span>
                  <span className="tnum text-ink-3">
                    {fmtInt(latest.importedEvents + latest.duplicateEvents)} {latest.estimatedRows ? `of ${fmtInt(latest.estimatedRows)}` : ""}
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-panel-2">
                  <div
                    className="h-full rounded-full bg-brand transition-[width] duration-700"
                    style={{ width: `${latest.estimatedRows ? Math.min(100, ((latest.importedEvents + latest.duplicateEvents) / latest.estimatedRows) * 100) : 10}%` }}
                  />
                </div>
                {admin && (
                  <Button className="mt-2" size="sm" variant="ghost" onClick={() => act("cancel", () => apiSend(`/api/v1/projects/${p.projectId}/migration/import/${latest.id}`, "POST", { action: "cancel" }))}>
                    Stop
                  </Button>
                )}
              </>
            ) : latest.status === "complete" ? (
              <p className="flex items-center gap-2 text-pos">
                <CheckCircle2 size={16} /> Copied {fmtInt(latest.importedEvents)} events and {fmtInt(latest.importedPersons)} people
                {latest.duplicateEvents ? ` (${fmtInt(latest.duplicateEvents)} were already here)` : ""}.
              </p>
            ) : (
              <div className="flex items-center justify-between gap-3">
                <p className={latest.status === "failed" ? "text-neg" : ""}>
                  {latest.status === "failed" ? "The copy stopped" : "The copy was stopped"} after {fmtInt(latest.importedEvents)} events.{latest.error ? ` ${latest.error}` : ""}
                </p>
                {admin && latest.method === "api" && (
                  <Button size="sm" onClick={() => act("resume", () => apiSend(`/api/v1/projects/${p.projectId}/migration/import/${latest.id}`, "POST", { action: "resume" }))}>
                    Continue
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
        {admin && !latest?.running && (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant={done.history ? "secondary" : "primary"}
              loading={busy === "import"}
              onClick={() =>
                act("import", () =>
                  apiSend(`/api/v1/projects/${p.projectId}/migration/import`, "POST", { from: new Date(Date.now() - Number(rangeDays) * 86400_000).toISOString(), to: new Date().toISOString() }),
                )
              }
            >
              {done.history ? "Copy again" : "Copy my history"}
            </Button>
            <Select aria-label="How far back" value={rangeDays} onChange={(e) => setRangeDays(e.target.value)}>
              <option value="30">last 30 days</option>
              <option value="90">last 90 days</option>
              <option value="365">last 12 months</option>
              <option value="730">last 2 years</option>
              <option value="2555">last 7 years</option>
            </Select>
          </div>
        )}
        <More label="More than a million events?">
          <p>Large projects copy faster through a PostHog export file:</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>In PostHog, go to Data pipelines → Destinations and add an S3 destination (R2, MinIO and other S3-compatible storage work too).</li>
            <li>Choose the Events model and JSON lines format, then run a backfill for the dates you want.</li>
            <li>Download the files from your storage and upload them here.</li>
          </ol>
          <p className="text-[12px] text-ink-3">PostHog may charge for exports above 1M rows a month.</p>
          {admin && (
            <>
              <input
                ref={fileRef}
                type="file"
                multiple
                accept=".jsonl,.json,.gz,.ndjson"
                className="hidden"
                onChange={async (e) => {
                  const files = [...(e.target.files ?? [])];
                  e.target.value = "";
                  for (const f of files)
                    await act("upload", async () => {
                      const res = await fetch(`/api/v1/projects/${p.projectId}/migration/upload`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/octet-stream", "x-filename": f.name }, body: f });
                      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: { message?: string } }).error?.message ?? `Upload failed (${res.status})`);
                    });
                }}
              />
              <Button size="sm" loading={busy === "upload"} onClick={() => fileRef.current?.click()}>
                <Upload size={14} /> Upload export files
              </Button>
            </>
          )}
          {jobs.length > 1 && (
            <ul className="space-y-0.5 pt-1 text-[12px] text-ink-3">
              {jobs.slice(1).map((j) => (
                <li key={j.id}>
                  {fmtRelative(j.createdAt)}: {j.method === "api" ? "from PostHog" : String(j.config.file ?? "file")} · {j.status} · {fmtInt(j.importedEvents)} events
                </li>
              ))}
            </ul>
          )}
        </More>
      </>
    ),

    compare: (
      <>
        <p>HostPog counts events and users for each of the last 14 days and checks them against PostHog. Today is left out because it isn&apos;t finished.</p>
        {busy === "rec" && <Spinner label="Counting in both places…" />}
        {rec && busy !== "rec" && (
          <>
            {rec.summary.checkedDays === 0 ? (
              <p className="rounded-md bg-panel-2 px-3 py-2.5">No finished days with data yet. Come back tomorrow, or after copying your history.</p>
            ) : rec.summary.mismatchedDays ? (
              <MismatchNote
                rec={rec}
                lastCopy={jobs.find((j) => j.status === "complete")?.createdAt ?? null}
                filling={gapJob ? { copied: (gap?.importedEvents ?? 0) + (gap?.duplicateEvents ?? 0) } : null}
                onGoToTracking={() => setStep("track")}
                onFill={
                  admin && !latest?.running
                    ? (fromDay) =>
                        void act("gap", async () => {
                          // Start a day early so the window covers the whole day in any timezone; duplicates are skipped by uuid.
                          const from = new Date(new Date(`${fromDay}T00:00:00Z`).getTime() - 86400_000).toISOString();
                          const r = await apiSend<{ job: { id: string } }>(`/api/v1/projects/${p.projectId}/migration/import`, "POST", { from, to: new Date().toISOString() });
                          setGapJob(r.job.id);
                        })
                    : null
                }
              />
            ) : (
              <p className="rounded-md bg-pos/10 px-3 py-2.5 text-pos">
                {rec.summary.checkedDays === 1 ? "The finished day matches" : `All ${rec.summary.checkedDays} finished days match`}: {fmtInt(rec.summary.hostpogEvents)} events in HostPog, {fmtInt(rec.summary.posthogEvents)} in PostHog.
              </p>
            )}
            <More label="Day by day" open={rec.summary.mismatchedDays > 0}>
              <table className="w-full text-[12px]">
                <thead className="text-left text-ink-3">
                  <tr>
                    <th className="py-1 font-normal">Day ({rec.timezone})</th>
                    <th className="py-1 text-right font-normal">PostHog</th>
                    <th className="py-1 text-right font-normal">HostPog</th>
                    <th className="py-1 text-right font-normal" />
                  </tr>
                </thead>
                <tbody className="tnum">
                  {rec.days
                    .filter((d) => d.status !== "empty")
                    .map((d) => (
                      <tr key={d.day} className="border-t border-line">
                        <td className="py-1">{d.day}</td>
                        <td className="py-1 text-right">{fmtInt(d.posthog.events)}</td>
                        <td className="py-1 text-right">{fmtInt(d.hostpog.events)}</td>
                        <td className={cx("py-1 text-right", d.status === "mismatch" && "font-medium text-warn")}>
                          {d.status === "match" ? "✓" : d.status === "partial_day" ? "today (not counted)" : `${d.hostpog.events > d.posthog.events ? "+" : "−"}${fmtInt(Math.abs(d.hostpog.events - d.posthog.events))}`}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
              <p className="text-[12px] text-ink-3">User counts can differ slightly for anonymous visitors.</p>
            </More>
          </>
        )}
        <Button loading={busy === "rec"} onClick={() => act("rec", async () => setRec(await apiGet<Reconcile>(`/api/v1/projects/${p.projectId}/migration/reconcile?days=14`)))}>
          Compare again
        </Button>
      </>
    ),

    switch:
      m.status === "cut_over" ? (
        <>
          <p className="flex items-center gap-2 text-pos">
            <CheckCircle2 size={16} /> You&apos;re on HostPog. Events stopped going to PostHog {fmtRelative(m.cutoverAt)}.
          </p>
          <p className="font-medium text-ink">To stop paying for PostHog:</p>
          <ol className="list-decimal space-y-1 pl-5">
            <li>Give it a few days. Keep your PostHog account until you&apos;re happy with HostPog.</li>
            <li>In PostHog, open Billing and unsubscribe or set your limits to $0. Delete any export you set up for this move.</li>
            <li>
              Disconnect PostHog in <Link className="text-brand-deep underline" href={p.href("settings/integrations")}>Integrations</Link>. HostPog deletes the key it stored.
            </li>
          </ol>
          <p className="text-ink-3">Your app can keep using the PostHog library with HostPog for as long as you like.</p>
          {admin && (
            <Button variant="ghost" onClick={() => confirm("Start copying events to PostHog again?") && act("rollback", () => post({ action: "rollback" }))}>
              Undo: send events to PostHog again
            </Button>
          )}
        </>
      ) : (
        <>
          <p>When you switch, HostPog stops passing events, feature flags and recordings on to PostHog, and becomes this project&apos;s home. You can undo this until you cancel PostHog.</p>
          <ul className="space-y-1.5">
            {checklistItems.map((c) => (
              <li key={c.key} className="flex items-start gap-2">
                {c.done ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-pos" /> : <span className="mt-[5px] h-2.5 w-2.5 shrink-0 rounded-full border border-ink-3" />}
                <span className={c.done ? "text-ink" : ""}>
                  {c.label}
                  {!c.done && <span className="text-ink-3"> · {c.detail}</span>}
                </span>
              </li>
            ))}
          </ul>
          {admin && (
            <>
              {checklistItems.some((c) => !c.done) && (
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={override} onChange={(e) => setOverride(e.target.checked)} /> Switch anyway
                </label>
              )}
              <Button
                variant="primary"
                loading={busy === "cutover"}
                disabled={(checklistItems.some((c) => !c.done) && !override) || busy === "rec"}
                onClick={() => confirm("Switch off PostHog? Events will only go to HostPog.") && act("cutover", () => post({ action: "cutover", confirm: override }))}
              >
                Switch off PostHog
              </Button>
            </>
          )}
        </>
      ),
  };

  const summary: Record<StepKey, string | null> = {
    review: usage ? (losing.length ? `${losing.length} to confirm` : "all covered") : null,
    track: m.trackingLastSeenAt ? `${fmtInt(m.capturedViaProxy)} events received` : null,
    history: latest?.status === "complete" ? `${fmtInt(latest.importedEvents + latest.duplicateEvents)} events` : latest?.running ? "copying…" : null,
    compare: rec && rec.summary.checkedDays ? (rec.summary.mismatchedDays ? `${rec.summary.mismatchedDays} ${rec.summary.mismatchedDays === 1 ? "day differs" : "days differ"}` : "numbers match") : null,
    switch: m.status === "cut_over" ? "done" : null,
  };
  const completed = STEPS.filter((x) => done[x.key]).length;

  return (
    <div className="mx-auto max-w-[960px] pt-2">
      <div className="mb-8">
        <h1 className="text-[26px] font-semibold tracking-tight">Move off PostHog</h1>
        <p className="mt-1 text-[14px] text-ink-2">
          {m.status === "cut_over" ? "Done. Your events now live in HostPog." : `${completed} of 5 done. Nothing changes for your users until the last step, and you can undo it.`}
        </p>
      </div>

      <div className="grid gap-8 md:grid-cols-[220px_minmax(0,1fr)]">
        {/* the route: PostHog at the top, HostPog at the bottom, filling as you go */}
        <nav aria-label="Migration steps" className="md:sticky md:top-20 md:self-start">
          <p className="mb-3 text-[12px] text-ink-3">From {s!.posthog?.label ?? "PostHog"}</p>
          <ol className="relative">
            {STEPS.map((x, i) => {
              const isDone = done[x.key];
              const active = x.key === current;
              return (
                <li key={x.key} className="relative pb-5 pl-8 last:pb-0">
                  {i < STEPS.length - 1 && <span aria-hidden className={cx("absolute left-[9px] top-6 h-[calc(100%-20px)] w-0.5 rounded-full", isDone ? "bg-brand" : "bg-line")} />}
                  <span
                    aria-hidden
                    className={cx(
                      "absolute left-0 top-0.5 flex h-5 w-5 items-center justify-center rounded-full border-2 text-[10px] font-semibold",
                      isDone ? "border-brand bg-brand text-on-brand" : active ? "border-brand bg-canvas text-brand-deep" : "border-line bg-canvas text-ink-3",
                    )}
                  >
                    {isDone ? <Check size={11} strokeWidth={3} /> : i + 1}
                  </span>
                  <button
                    onClick={() => setStep(x.key)}
                    aria-current={active ? "step" : undefined}
                    className={cx("block text-left text-[13px] leading-5 hover:text-ink", active ? "font-semibold text-ink" : isDone ? "text-ink" : "text-ink-2")}
                  >
                    {x.title}
                    {summary[x.key] && <span className="block text-[12px] font-normal text-ink-3">{summary[x.key]}</span>}
                  </button>
                </li>
              );
            })}
          </ol>
          <p className="mt-3 text-[12px] text-ink-3">To HostPog</p>
        </nav>

        <section className="min-w-0" aria-labelledby="step-title">
          <p className="text-[12px] text-ink-3">Step {idx + 1} of 5</p>
          <h2 id="step-title" className="mt-0.5 text-[20px] font-semibold tracking-tight">
            {STEPS[idx]!.title}
          </h2>
          {err && (
            <div className="mt-3">
              <ErrorBox error={err} />
            </div>
          )}
          <div className="mt-4 space-y-4 text-[14px] leading-6 text-ink-2">{body[current]}</div>
          <div className="mt-8 flex items-center justify-between border-t border-line pt-4">
            {idx > 0 ? (
              <Button variant="ghost" onClick={() => setStep(STEPS[idx - 1]!.key)}>
                Back
              </Button>
            ) : (
              <span />
            )}
            {idx < STEPS.length - 1 && (
              <Button variant={done[current] ? "primary" : "ghost"} onClick={() => setStep(STEPS[idx + 1]!.key)}>
                {done[current] ? "Next step" : "Skip for now"}
              </Button>
            )}
          </div>
          {m.status === "cut_over" && current !== "switch" && <Badge className="mt-4" tone="pos">Switched {fmtRelative(m.cutoverAt)}</Badge>}
        </section>
      </div>
    </div>
  );
}
