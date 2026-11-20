"use client";
import type { EvidenceRecord } from "@hostpog/ai";
import type { InvestigationReport } from "@hostpog/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, ClipboardCopy, Cpu, PanelRightClose, PanelRightOpen, Pencil, Plus, RotateCcw, Sparkles, Square, Trash2 } from "lucide-react";
import { RowMenu } from "@/components/row-menu";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { usePendingQuestion } from "@/lib/pending-question";
import { ConnectAI, rankModels } from "@/components/connect-ai";
import { useProject } from "@/components/project-context";
import { Badge, Button, cx, Empty, ErrorBox, Field, JsonView, PageHeader, Section, Select, Spinner } from "@/components/ui";
import { apiGet, apiSend, apiText } from "@/lib/api";
import { fmtRelative, withParam } from "@/lib/format";

interface Inv {
  id: string;
  title: string;
  question: string;
  status: "running" | "complete" | "failed" | "cancelled";
  model: string | null;
  createdAt: string;
  error: string | null;
  providerId?: string | null;
  sourceId?: string | null;
  usage: { inputTokens: number; outputTokens: number; requests: number; toolCalls: number } | null;
  report: (InvestigationReport & { finishedBy?: string; validationNotes?: string[] }) | null;
}

const MODEL_GONE = /(no longer available|not found|does not exist|deprecated|decommissioned|unsupported model|invalid model|model_not_found|404)/i;

type ProviderRow = { id: string; label: string; model: string; enabled: boolean; provider: string };

/** Everything needed to run an investigation again: the provider, a ranked model list, and a `rerun` that starts a new one. */
function useRerun(inv: Inv, onStarted: (id: string) => void) {
  const p = useProject();
  const qc = useQueryClient();
  const providers = useQuery({
    queryKey: ["ai-providers", p.workspaceId],
    queryFn: () => apiGet<{ providers: ProviderRow[] }>(`/api/v1/workspaces/${p.workspaceId}/ai-providers`),
  });
  const list = (providers.data?.providers ?? []).filter((x) => x.enabled);
  const [providerId, setProviderId] = useState<string>(inv.providerId ?? "");
  const prov = list.find((x) => x.id === providerId) ?? list[0];
  const canPickModel = p.can("admin");
  const models = useQuery({
    queryKey: ["ai-models", p.workspaceId, prov?.id],
    queryFn: () => apiSend<{ models: string[] }>(`/api/v1/workspaces/${p.workspaceId}/ai-models`, "POST", { providerId: prov!.id }),
    enabled: Boolean(prov && canPickModel),
    staleTime: 5 * 60_000,
  });
  const modelGone = inv.status === "failed" && Boolean(inv.error && MODEL_GONE.test(inv.error));
  const ranked = prov && models.data ? rankModels(prov.provider === "openai_compatible" ? "ollama" : prov.provider, models.data.models) : [];
  const [model, setModel] = useState<string>("");
  useEffect(() => {
    if (!prov) return;
    // If the run failed because the model is gone, preselect the best alternative once the list loads.
    const alt = ranked.find((m) => m !== prov.model && m !== inv.model);
    setModel((cur) => {
      if (modelGone && alt && (!cur || cur === inv.model || cur === prov.model)) return alt;
      return cur || prov.model;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prov?.id, models.data]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const rerun = async (question: string) => {
    if (!prov) return;
    setBusy(true);
    setErr(null);
    try {
      if (model && model !== prov.model && canPickModel) {
        await apiSend(`/api/v1/workspaces/${p.workspaceId}/ai-providers/${prov.id}`, "PATCH", { model });
        await qc.invalidateQueries({ queryKey: ["ai-providers", p.workspaceId] });
      }
      const r = await apiSend<{ investigation: { id: string } }>(`/api/v1/projects/${p.projectId}/investigations`, "POST", {
        question: question.trim(),
        providerId: prov.id,
        sourceId: inv.sourceId ?? p.sourceId,
      });
      onStarted(r.investigation.id);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return { list, prov, setProviderId, models, ranked, model, setModel, modelGone, canPickModel, busy, err, rerun };
}
type Rerun = ReturnType<typeof useRerun>;

/** Compact "provider · model · Run again" row. Used under an error, or when picking "Run with another model". */
function ModelRow({ r, question, onCancel }: { r: Rerun; question: string; onCancel?: () => void }) {
  if (!r.list.length) return null;
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {r.list.length > 1 && (
          <Select
            aria-label="Provider"
            value={r.prov?.id ?? ""}
            onChange={(e) => {
              r.setProviderId(e.target.value);
              r.setModel("");
            }}
          >
            {r.list.map((x) => (
              <option key={x.id} value={x.id}>
                {x.label}
              </option>
            ))}
          </Select>
        )}
        {r.canPickModel ? (
          <Select aria-label="Model" value={r.model} onChange={(e) => r.setModel(e.target.value)} className="min-w-[240px]" disabled={r.models.isLoading}>
            {r.models.isLoading && <option value="">Loading models…</option>}
            {[...new Set([r.model, ...r.ranked].filter(Boolean))].map((m) => (
              <option key={m} value={m}>
                {m}
                {m === r.ranked[0] ? " (recommended)" : ""}
              </option>
            ))}
          </Select>
        ) : (
          <span className="text-[13px] text-ink-3">{r.prov?.model}</span>
        )}
        <Button variant="primary" loading={r.busy} disabled={!r.prov || (r.canPickModel && !r.model)} onClick={() => void r.rerun(question)}>
          <RotateCcw size={13} /> Run again
        </Button>
        {onCancel && (
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
      {r.prov && r.model && r.model !== r.prov.model && <p className="text-[12px] text-ink-3">{r.model} becomes the default model for {r.prov.label}.</p>}
      {r.models.error && <p className="text-[12px] text-ink-3">Couldn&apos;t load the model list: {(r.models.error as Error).message}</p>}
      {r.err && <ErrorBox error={r.err} />}
    </div>
  );
}

/** Question, status and actions for one investigation. The question itself is editable in place (pencil or ⋯ menu). */
function InvestigationHead({ inv, onStarted, onDeleted }: { inv: Inv; onStarted: (id: string) => void; onDeleted: () => void }) {
  const p = useProject();
  const r = useRerun(inv, onStarted);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(inv.question);
  const [pickModel, setPickModel] = useState(false);
  const canAct = p.can("member") && inv.status !== "running";
  const failed = inv.status === "failed";

  const startEdit = () => {
    setDraft(inv.question);
    setEditing(true);
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[12px] text-ink-3">Question</p>
          {editing ? (
            <div className="mt-1 space-y-2">
              <textarea
                autoFocus
                rows={2}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") setEditing(false);
                  if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && draft.trim()) void r.rerun(draft);
                }}
                className="w-full resize-y rounded-lg border border-line-strong bg-panel px-2.5 py-2 text-[14px] outline-none"
              />
              <div className="flex items-center gap-2">
                <Button size="sm" variant="primary" loading={r.busy} disabled={!draft.trim() || !r.prov} onClick={() => void r.rerun(draft)}>
                  Ask
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
                <span className="text-[12px] text-ink-3">Runs as a new investigation · ⌘↵</span>
              </div>
              {r.err && <ErrorBox error={r.err} />}
            </div>
          ) : (
            <div className="group flex items-start gap-1.5">
              <p className="text-[15px] font-medium">{inv.question}</p>
              {canAct && r.list.length > 0 && (
                <button
                  onClick={startEdit}
                  aria-label="Edit question"
                  className="mt-0.5 shrink-0 rounded p-1 text-ink-3 opacity-60 hover:bg-panel-2 hover:text-ink hover:opacity-100 group-hover:opacity-100"
                >
                  <Pencil size={13} />
                </button>
              )}
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Badge tone={STATUS_TONE[inv.status]}>{inv.status}</Badge>
          {inv.status === "running" && (
            <Button size="sm" onClick={() => apiSend(`/api/v1/projects/${p.projectId}/investigations/${inv.id}`, "POST", { action: "cancel" })}>
              <Square size={12} /> Cancel
            </Button>
          )}
          {canAct && (
            <RowMenu
              items={[
                { label: "Run again", icon: <RotateCcw size={14} />, onSelect: () => void r.rerun(inv.question), hidden: !r.list.length || failed, disabled: r.busy },
                { label: "Run with another model", icon: <Cpu size={14} />, onSelect: () => setPickModel(true), hidden: !r.list.length || failed || !(r.canPickModel || r.list.length > 1) },
                {
                  label: "Delete",
                  icon: <Trash2 size={14} />,
                  danger: true,
                  onSelect: async () => {
                    await apiSend(`/api/v1/projects/${p.projectId}/investigations/${inv.id}`, "DELETE");
                    onDeleted();
                  },
                },
              ]}
            />
          )}
        </div>
      </div>
      {inv.status === "running" && <Spinner label="Investigating…" />}
      {failed && (
        <div className="space-y-3 rounded-xl border border-neg/30 bg-neg/5 p-4">
          <div>
            <p className="text-[13px] font-medium text-neg">{r.modelGone ? `${inv.model ?? "This model"} isn't available on your account anymore.` : "This investigation didn't finish."}</p>
            {!r.modelGone && inv.error && <p className="mt-0.5 text-[12px] text-ink-3">{inv.error}</p>}
          </div>
          {canAct && !editing && (
            <>
              <p className="text-[13px] text-ink-2">{r.modelGone ? "Pick another model and run it again:" : "Run it again, or try a different model:"}</p>
              <ModelRow r={r} question={inv.question} />
            </>
          )}
        </div>
      )}
      {!failed && pickModel && !editing && (
        <div className="rounded-xl border border-line p-4">
          <p className="mb-2 text-[13px] font-medium">Run with another model</p>
          <ModelRow r={r} question={inv.question} onCancel={() => setPickModel(false)} />
        </div>
      )}
      {inv.status === "cancelled" && !pickModel && <p className="text-[13px] text-ink-3">Cancelled. Use ⋯ to run it again.</p>}
    </div>
  );
}

const STATUS_TONE = { running: "warn", complete: "pos", failed: "neg", cancelled: "neutral" } as const;
const HYP_TONE = { supported: "pos", correlated: "warn", unproven: "neutral", contradicted: "neg" } as const;

function NewInvestigation({ onStarted }: { onStarted: (id: string) => void }) {
  const p = useProject();
  const [pending, forgetPending] = usePendingQuestion();
  const [question, setQuestion] = useState("");
  useEffect(() => {
    if (pending) setQuestion((q) => q || pending);
  }, [pending]);
  const [providerId, setProviderId] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const providers = useQuery({
    queryKey: ["ai-providers", p.workspaceId],
    queryFn: () => apiGet<{ providers: { id: string; label: string; model: string; enabled: boolean; allowRawEvents: boolean; provider: string }[] }>(`/api/v1/workspaces/${p.workspaceId}/ai-providers`),
  });
  const list = (providers.data?.providers ?? []).filter((x) => x.enabled);
  const chosen = list.find((x) => x.id === (providerId || list[0]?.id));
  if (providers.isLoading) return <Spinner label="Loading" />;
  if (providers.data && !list.length)
    return (
      <div className="space-y-4">
        <div>
          <p className="text-[15px] font-semibold">Connect a model to {pending ? "answer your question" : "start asking questions"}</p>
          <p className="mt-0.5 text-[13px] text-ink-3">
            {pending ? (
              <>
                <span className="font-medium text-ink">“{pending}”</span> is saved and will be ready to ask as soon as you connect.
              </>
            ) : (
              "Charts and dashboards work without AI. Questions run on your own key, billed by your provider."
            )}
          </p>
        </div>
        <ConnectAI compact onConnected={() => void providers.refetch()} />
      </div>
    );
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setErr(null);
        try {
          const r = await apiSend<{ investigation: { id: string } }>(`/api/v1/projects/${p.projectId}/investigations`, "POST", { question, providerId: chosen!.id, sourceId: p.sourceId });
          onStarted(r.investigation.id);
          if (pending && question.trim() === pending.trim()) forgetPending();
          setQuestion("");
        } catch (e) {
          setErr((e as Error).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {pending && question === pending && <p className="text-[12px] text-ink-3">Your question from the homepage — edit it or ask as is.</p>}
      <Field label="What do you want to know?">
        {(id) => (
          <textarea
            id={id}
            rows={3}
            className="w-full rounded-md border border-line bg-panel px-2.5 py-2 text-[14px]"
            placeholder="e.g. Why did onboarding completion drop in the last two weeks?"
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
          />
        )}
      </Field>
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="AI provider" value={chosen?.id ?? ""} onChange={(e) => setProviderId(e.target.value)}>
          {list.map((x) => (
            <option key={x.id} value={x.id}>
              {x.label} · {x.model}
            </option>
          ))}
        </Select>
        <Button type="submit" variant="primary" loading={busy} disabled={question.trim().length < 5 || !chosen || !p.can("member")}>
          Investigate
        </Button>
      </div>
      <p className="text-[12px] text-ink-3">
        Runs on {chosen?.label}. Only aggregates are shared{chosen?.allowRawEvents ? ", plus redacted event properties" : ""}.
      </p>
      {err && <ErrorBox error={err} />}
    </form>
  );
}

function Report({ inv, evidence, onCite }: { inv: Inv; evidence: EvidenceRecord[]; onCite: (id: string) => void }) {
  const p = useProject();
  const [copied, setCopied] = useState<string | null>(null);
  const r = inv.report!;
  const copy = async (format: "ticket" | "prompt") => {
    const text = await apiText(`/api/v1/projects/${p.projectId}/investigations/${inv.id}?format=${format}`);
    await navigator.clipboard.writeText(text);
    setCopied(format);
    setTimeout(() => setCopied(null), 1500);
  };
  const Cite = ({ ids }: { ids: string[] }) => (
    <>
      {ids.map((id) => (
        <button key={id} onClick={() => onCite(id)} className="ml-1 rounded bg-panel-2 px-1 font-mono text-[11px] text-brand-deep hover:underline">
          {id}
        </button>
      ))}
    </>
  );
  return (
    <article className="space-y-5 text-[14px] leading-6">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={r.kind === "issue" ? "neg" : r.kind === "opportunity" ? "pos" : "neutral"}>{r.kind.replace("_", " ")}</Badge>
          <Badge tone={r.confidence === "high" ? "pos" : r.confidence === "medium" ? "warn" : "neutral"}>{r.confidence} confidence</Badge>
        </div>
        <h2 className="mt-2 text-[20px] font-semibold leading-tight">{r.title}</h2>
        <p className="mt-2 text-ink-2">{r.summary}</p>
        <p className="mt-1 text-[12px] text-ink-3">Why this confidence: {r.confidenceReason}</p>
      </div>
      {(r.baseline || r.current || r.impactEstimate) && (
        <dl className="grid grid-cols-1 divide-y divide-line rounded-md border border-line sm:grid-cols-3 sm:divide-x sm:divide-y-0">
          {[
            ["Baseline", r.baseline],
            ["Current", r.current],
            ["Impact estimate", r.impactEstimate],
          ].map(([k, v]) => (
            <div key={k} className="px-3 py-2">
              <dt className="text-[12px] text-ink-3">{k}</dt>
              <dd className="text-[13px]">{v ?? "—"}</dd>
            </div>
          ))}
        </dl>
      )}
      {r.assumptions.length > 0 && <p className="text-[12px] text-ink-3">Assumptions: {r.assumptions.join("; ")}</p>}
      <section>
        <h3 className="text-[13px] font-semibold">Observed in the data</h3>
        <ul className="mt-1 list-disc space-y-1 pl-5">
          {r.observations.map((o, i) => (
            <li key={i}>
              {o.statement}
              <Cite ids={o.evidenceIds} />
            </li>
          ))}
          {!r.observations.length && <li className="text-ink-3">No evidence-backed observations.</li>}
        </ul>
      </section>
      <section>
        <h3 className="text-[13px] font-semibold">Hypotheses</h3>
        <ul className="mt-1 space-y-1">
          {r.hypotheses.map((h, i) => (
            <li key={i} className="flex items-start gap-2">
              <Badge tone={HYP_TONE[h.status]} className="mt-1 shrink-0">
                {h.status}
              </Badge>
              <span>
                {h.statement}
                <Cite ids={h.evidenceIds} />
              </span>
            </li>
          ))}
        </ul>
      </section>
      {r.affectedSegments.length > 0 && (
        <section>
          <h3 className="text-[13px] font-semibold">Affected segments</h3>
          <p className="text-ink-2">{r.affectedSegments.join(" · ")}</p>
        </section>
      )}
      {r.reproductionSteps.length > 0 && (
        <section>
          <h3 className="text-[13px] font-semibold">Reproduction</h3>
          <ol className="list-decimal pl-5 text-ink-2">
            {r.reproductionSteps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </section>
      )}
      <section className="rounded-md border border-line bg-panel-2 px-3 py-2">
        <h3 className="text-[13px] font-semibold">Recommendation</h3>
        <p>{r.recommendation}</p>
        <p className="mt-1 text-[12px] text-ink-2">
          Validate with: {r.validationMetric} · Next: {r.nextAction}
        </p>
      </section>
      {(r.limitations.length > 0 || r.validationNotes?.length) && (
        <section>
          <h3 className="text-[13px] font-semibold">Limitations</h3>
          <ul className="list-disc pl-5 text-[13px] text-ink-2">
            {r.limitations.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
            {r.validationNotes?.map((l, i) => (
              <li key={`v${i}`} className="text-warn">
                {l}
              </li>
            ))}
          </ul>
        </section>
      )}
      <div className="flex flex-wrap gap-2 border-t border-line pt-4">
        <Button size="sm" onClick={() => copy("ticket")}>
          {copied === "ticket" ? <Check size={14} /> : <ClipboardCopy size={14} />} Copy engineering ticket
        </Button>
        <Button size="sm" onClick={() => copy("prompt")}>
          {copied === "prompt" ? <Check size={14} /> : <ClipboardCopy size={14} />} Copy prompt for Claude Code / Codex
        </Button>
      </div>
      <p className="text-[12px] text-ink-3">
        {inv.model} · {inv.usage ? `${inv.usage.inputTokens.toLocaleString()} input / ${inv.usage.outputTokens.toLocaleString()} output tokens, ${inv.usage.toolCalls} tool calls` : ""} · {evidence.length} evidence items
      </p>
    </article>
  );
}

function EvidencePanel({ evidence, focus }: { evidence: EvidenceRecord[]; focus: string | null }) {
  return (
    <ol className="space-y-2">
      {evidence.map((e) => (
        <li key={e.id} id={`evidence-${e.id}`} className={cx("rounded-md border bg-panel p-2", focus === e.id ? "border-brand" : "border-line")}>
          <details open={focus === e.id}>
            <summary className="cursor-pointer text-[12px]">
              <span className="font-mono text-brand-deep">{e.id}</span> <span className="font-medium">{e.tool}</span>
              {e.meta.error && <span className="ml-1 text-neg">error</span>}
              <span className="block truncate text-ink-3">{JSON.stringify(e.input)}</span>
            </summary>
            <div className="mt-2 space-y-2 text-[11px]">
              <p className="text-ink-3">
                {e.meta.source?.label} · {e.meta.range ? `${e.meta.range.from.slice(0, 10)} → ${e.meta.range.to.slice(0, 10)}` : "no range"} · {e.meta.timezone ?? ""} · fp {e.meta.fingerprint ?? "—"}
              </p>
              {e.meta.queries.map((q, i) => (
                <pre key={i} className="overflow-auto rounded border border-line bg-panel-2 p-2 font-mono text-[11px]">
                  {q.text}
                </pre>
              ))}
              <JsonView value={e.output} />
            </div>
          </details>
        </li>
      ))}
      {!evidence.length && <li className="text-[12px] text-ink-3">Evidence will appear here.</li>}
    </ol>
  );
}

export default function Investigations() {
  const p = useProject();
  const sp = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const id = sp.get("id");
  const [panel, setPanel] = useState(true);
  const [focus, setFocus] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ["investigations", p.projectId],
    queryFn: () => apiGet<{ investigations: { id: string; title: string; status: Inv["status"]; createdAt: string }[] }>(`/api/v1/projects/${p.projectId}/investigations`),
    refetchInterval: (q) => (q.state.data?.investigations.some((i) => i.status === "running") ? 3000 : false),
  });
  const detail = useQuery({
    queryKey: ["investigation", p.projectId, id],
    queryFn: () => apiGet<{ investigation: Inv; evidence: EvidenceRecord[] }>(`/api/v1/projects/${p.projectId}/investigations/${id}`),
    enabled: Boolean(id),
    refetchInterval: (q) => (q.state.data?.investigation.status === "running" ? 2000 : false),
  });
  const providers = useQuery({
    queryKey: ["ai-providers", p.workspaceId],
    queryFn: () => apiGet<{ providers: { id: string; enabled: boolean }[] }>(`/api/v1/workspaces/${p.workspaceId}/ai-providers`),
  });
  const [pending] = usePendingQuestion();
  const open = (newId: string | null) => router.push(newId ? withParam(p.href("investigations"), "id", newId) : p.href("investigations"));
  const inv = detail.data?.investigation;
  const ev = detail.data?.evidence ?? [];
  const hasHistory = (list.data?.investigations.length ?? 0) > 0;

  // First run: no model yet. One focused setup page instead of an empty history column and a card inside a card.
  if (!id && providers.data && !providers.data.providers.some((x) => x.enabled)) {
    return (
      <div className="mx-auto max-w-[920px]">
        <PageHeader title="Investigations" description="Ask why a metric moved and get an answer backed by the queries behind it." />
        {pending && (
          <div className="mb-5 flex items-start gap-3 rounded-xl border border-line bg-panel px-5 py-4 shadow-card">
            <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand-deep">
              <Sparkles size={15} aria-hidden />
            </span>
            <div className="min-w-0 text-[13px]">
              <p className="text-ink-3">Your question — ready to ask as soon as a model is connected</p>
              <p className="mt-0.5 text-[15px] font-medium">“{pending}”</p>
            </div>
          </div>
        )}
        <Section title="Connect a model">
          <div className="px-5 pb-5 pt-1">
            <ConnectAI onConnected={() => void providers.refetch()} />
          </div>
        </Section>
      </div>
    );
  }

  return (
    <div className={cx("mx-auto grid gap-5", hasHistory || id ? "max-w-[1440px] lg:grid-cols-[220px_1fr_auto]" : "max-w-[920px]")}>
      {(hasHistory || id) && (
      <aside aria-label="Investigation history" className="space-y-2">
        <Button className="w-full" onClick={() => open(null)}>
          <Plus size={14} /> New investigation
        </Button>
        <ul className="space-y-px">
          {(list.data?.investigations ?? []).map((i) => (
            <li key={i.id}>
              <button onClick={() => open(i.id)} className={cx("w-full rounded-md px-2 py-1.5 text-left text-[13px] hover:bg-panel-2", id === i.id && "bg-panel-2")}>
                <span className="line-clamp-2">{i.title}</span>
                <span className="text-[11px] text-ink-3">
                  {i.status} · {fmtRelative(i.createdAt)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>
      )}
      <section className="min-w-0 rounded-xl border border-line bg-panel p-6 shadow-card">
        {!id && (
          <>
            <h1 className="mb-4 text-[24px] font-semibold tracking-tight">Investigate</h1>
            <NewInvestigation onStarted={(x) => {
              void qc.invalidateQueries({ queryKey: ["investigations", p.projectId] });
              open(x);
            }} />
          </>
        )}
        {id && detail.error && <ErrorBox error={detail.error} />}
        {id && inv && (
          <div className="space-y-4">
            <InvestigationHead
              key={inv.id}
              inv={inv}
              onStarted={(x) => {
                void qc.invalidateQueries({ queryKey: ["investigations", p.projectId] });
                open(x);
              }}
              onDeleted={async () => {
                await qc.invalidateQueries({ queryKey: ["investigations", p.projectId] });
                open(null);
              }}
            />
            {inv.status === "running" && ev.length > 0 && <p className="text-[12px] text-ink-3">{ev.length} queries so far</p>}
            {inv.report && (
              <Report
                inv={inv}
                evidence={ev}
                onCite={(x) => {
                  setPanel(true);
                  setFocus(x);
                  setTimeout(() => document.getElementById(`evidence-${x}`)?.scrollIntoView({ block: "nearest" }), 50);
                }}
              />
            )}
          </div>
        )}
      </section>
      {id && (
        <aside aria-label="Evidence" className={cx("min-w-0", panel ? "lg:w-[380px]" : "lg:w-10")}>
          <div className="mb-2 flex items-center justify-between">
            {panel && <h2 className="text-[13px] font-semibold">Evidence</h2>}
            <Button size="sm" variant="ghost" aria-label={panel ? "Collapse evidence" : "Expand evidence"} onClick={() => setPanel((x) => !x)}>
              {panel ? <PanelRightClose size={16} /> : <PanelRightOpen size={16} />}
            </Button>
          </div>
          {panel && <EvidencePanel evidence={ev} focus={focus} />}
        </aside>
      )}
    </div>
  );
}
