"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowLeft, ArrowUp, Pause, Play, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { pct, Stat, StatusBadge } from "@/components/products/shared";
import type { QuestionResult, SurveyQuestionDraft, SurveyResults, SurveyRow } from "@/components/products/types";
import { useProject } from "@/components/project-context";
import { RowMenu } from "@/components/row-menu";
import { Button, cx, Empty, ErrorBox, Field, Input, PageHeader, Section, Segmented, Select, Spinner } from "@/components/ui";
import { apiGet, apiSend } from "@/lib/api";
import { fmtInt, fmtRelative } from "@/lib/format";

const rid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : String(Math.random()).slice(2));

const TEMPLATES: { label: string; name: string; questions: () => SurveyQuestionDraft[] }[] = [
  {
    label: "NPS",
    name: "Net Promoter Score",
    questions: () => [
      { id: rid(), type: "rating", question: "How likely are you to recommend us to a friend or colleague?", isNps: true, scale: 10, display: "number", lowerBoundLabel: "Unlikely", upperBoundLabel: "Very likely" },
      { id: rid(), type: "open", question: "What's the main reason for your score?", optional: true },
    ],
  },
  {
    label: "Satisfaction",
    name: "Customer satisfaction",
    questions: () => [{ id: rid(), type: "rating", question: "How satisfied are you with the product?", scale: 5, display: "emoji", lowerBoundLabel: "Unhappy", upperBoundLabel: "Love it" }],
  },
  {
    label: "Open feedback",
    name: "Feedback",
    questions: () => [{ id: rid(), type: "open", question: "What's one thing we could do better?" }],
  },
  {
    label: "Multiple choice",
    name: "What brought you here",
    questions: () => [{ id: rid(), type: "single_choice", question: "How did you hear about us?", choices: ["Search", "A friend", "Social media", "Other"] }],
  },
];

type Draft = Pick<SurveyRow, "name" | "questions" | "urlContains" | "waitDays" | "thankYouMessage">;

export default function SurveyPage() {
  const p = useProject();
  const qc = useQueryClient();
  const router = useRouter();
  const sp = useSearchParams();
  const { surveyId } = useParams<{ surveyId: string }>();
  const isNew = surveyId === "new";
  const url = `/api/v1/projects/${p.projectId}/surveys/${surveyId}`;
  const q = useQuery({
    queryKey: ["survey", surveyId, p.sourceId],
    queryFn: () => apiGet<{ survey: SurveyRow; results: SurveyResults | null }>(`${url}${p.sourceId ? `?source=${p.sourceId}` : ""}`),
    enabled: !isNew,
  });
  const s = q.data?.survey;
  const [tab, setTab] = useState<"results" | "edit">(sp.get("tab") === "edit" ? "edit" : "results");
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const member = p.can("member");

  const act = async (action: "launch" | "stop") => {
    setBusy(action);
    setErr(null);
    try {
      await apiSend(url, "PATCH", { action });
      await qc.invalidateQueries({ queryKey: ["survey", surveyId] });
      await qc.invalidateQueries({ queryKey: ["surveys", p.projectId] });
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(null);
    }
  };

  if (!isNew && q.isLoading) return <Spinner />;
  if (!isNew && (q.error || !s)) return <ErrorBox error={q.error ?? new Error("Survey not found")} />;
  const launched = Boolean(s?.startedAt);
  const showEditor = isNew || !launched || tab === "edit";

  const primary =
    !member || isNew ? null : s!.status === "active" ? (
      <Button loading={busy === "stop"} onClick={() => act("stop")}>
        <Pause size={13} /> Stop
      </Button>
    ) : (
      <Button variant="primary" loading={busy === "launch"} onClick={() => act("launch")}>
        <Play size={13} /> {s!.status === "draft" ? "Launch" : "Resume"}
      </Button>
    );

  return (
    <div className="mx-auto max-w-[1100px] space-y-5">
      <Link href={p.href("surveys")} className="inline-flex items-center gap-1 text-[13px] text-ink-3 hover:text-ink">
        <ArrowLeft size={13} /> Surveys
      </Link>
      <PageHeader
        title={
          isNew ? (
            "New survey"
          ) : (
            <span className="flex items-center gap-2">
              {s!.name} <StatusBadge status={s!.status} />
            </span>
          )
        }
        description={!isNew && s!.startedAt ? `Live since ${fmtRelative(s!.startedAt)}${s!.urlContains ? ` on pages containing “${s!.urlContains}”` : ""}` : undefined}
        actions={
          <div className="flex items-center gap-2">
            {primary}
            {member && !isNew && (
              <RowMenu
                items={[
                  {
                    label: "Delete survey",
                    icon: <Trash2 size={14} />,
                    danger: true,
                    onSelect: async () => {
                      if (!confirm(`Delete "${s!.name}"? Responses stay in your events.`)) return;
                      try {
                        await apiSend(url, "DELETE");
                        await qc.invalidateQueries({ queryKey: ["surveys", p.projectId] });
                        router.push(p.href("surveys"));
                      } catch (e) {
                        setErr(e);
                      }
                    },
                  },
                ]}
              />
            )}
          </div>
        }
      />
      {err != null && <ErrorBox error={err} />}
      {launched && !isNew && (
        <Segmented
          label="View"
          value={tab}
          onChange={setTab}
          options={[
            { value: "results", label: "Results" },
            { value: "edit", label: "Edit" },
          ]}
        />
      )}
      {showEditor ? (
        <SurveyEditor
          initial={s}
          readOnly={!member}
          onSaved={async (saved) => {
            await qc.invalidateQueries({ queryKey: ["surveys", p.projectId] });
            if (isNew) router.replace(p.href(`surveys/${saved.id}`));
            else await qc.invalidateQueries({ queryKey: ["survey", surveyId] });
          }}
        />
      ) : (
        <Results r={q.data!.results} survey={s!} />
      )}
    </div>
  );
}

function SurveyEditor({ initial, readOnly, onSaved }: { initial?: SurveyRow; readOnly: boolean; onSaved: (s: SurveyRow) => void }) {
  const p = useProject();
  const [d, setD] = useState<Draft | null>(initial ? { name: initial.name, questions: initial.questions, urlContains: initial.urlContains, waitDays: initial.waitDays, thankYouMessage: initial.thankYouMessage } : null);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => setSaved(false), [d]);

  if (!d) {
    return (
      <Section title="Start from a template">
        <div className="grid gap-3 p-5 sm:grid-cols-2 lg:grid-cols-4">
          {TEMPLATES.map((t) => (
            <button
              key={t.label}
              onClick={() => setD({ name: t.name, questions: t.questions(), urlContains: "", waitDays: 30, thankYouMessage: "Thanks for the feedback!" })}
              className="rounded-xl border border-line bg-panel p-4 text-left hover:border-brand/40 hover:bg-brand-soft"
            >
              <p className="text-[14px] font-medium">{t.label}</p>
              <p className="mt-1 text-[12px] text-ink-3">{t.questions()[0]!.question}</p>
            </button>
          ))}
        </div>
      </Section>
    );
  }

  const setQ = (i: number, patch: Partial<SurveyQuestionDraft>) => setD({ ...d, questions: d.questions.map((q, j) => (j === i ? { ...q, ...patch } : q)) });
  const move = (i: number, dir: -1 | 1) => {
    const qs = [...d.questions];
    [qs[i], qs[i + dir]] = [qs[i + dir]!, qs[i]!];
    setD({ ...d, questions: qs });
  };
  const save = async () => {
    setSaving(true);
    setErr(null);
    try {
      const base = `/api/v1/projects/${p.projectId}/surveys`;
      const clean = { ...d, questions: d.questions.map((q) => (q.choices ? { ...q, choices: q.choices.map((c) => c.trim()).filter(Boolean) } : q)) };
      const r = initial ? await apiSend<{ survey: SurveyRow }>(`${base}/${initial.id}`, "PATCH", clean) : await apiSend<{ survey: SurveyRow }>(base, "POST", clean);
      setSaved(true);
      onSaved(r.survey);
    } catch (e) {
      setErr(e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <div className="space-y-5">
        <Section title="Survey">
          <div className="grid gap-4 p-5 sm:grid-cols-2">
            <Field label="Name (only you see this)">{(id) => <Input id={id} value={d.name} disabled={readOnly} onChange={(e) => setD({ ...d, name: e.target.value })} />}</Field>
            <Field label="Show on pages whose URL contains" hint="Leave empty to show anywhere in your app.">
              {(id) => <Input id={id} value={d.urlContains} disabled={readOnly} placeholder="/app" onChange={(e) => setD({ ...d, urlContains: e.target.value })} />}
            </Field>
            <Field label="Don't ask the same person again for (days)">
              {(id) => <Input id={id} type="number" min={0} max={365} value={d.waitDays} disabled={readOnly} onChange={(e) => setD({ ...d, waitDays: Number(e.target.value) })} className="w-28" />}
            </Field>
            <Field label="Thank-you message">{(id) => <Input id={id} value={d.thankYouMessage} disabled={readOnly} onChange={(e) => setD({ ...d, thankYouMessage: e.target.value })} />}</Field>
          </div>
        </Section>
        {d.questions.map((q, i) => (
          <Section
            key={q.id}
            title={`Question ${i + 1}`}
            actions={
              !readOnly && (
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp size={13} />
                  </Button>
                  <Button size="sm" variant="ghost" aria-label="Move down" disabled={i === d.questions.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDown size={13} />
                  </Button>
                  <Button size="sm" variant="ghost" aria-label="Remove question" disabled={d.questions.length === 1} onClick={() => setD({ ...d, questions: d.questions.filter((_, j) => j !== i) })}>
                    <X size={14} />
                  </Button>
                </div>
              )
            }
          >
            <div className="grid gap-4 p-5 sm:grid-cols-[1fr_200px]">
              <Field label="Question">{(id) => <Input id={id} value={q.question} disabled={readOnly} onChange={(e) => setQ(i, { question: e.target.value })} />}</Field>
              <Field label="Type">
                {(id) => (
                  <Select
                    id={id}
                    value={q.isNps ? "nps" : q.type}
                    disabled={readOnly}
                    onChange={(e) => {
                      const v = e.target.value;
                      if (v === "nps") setQ(i, { type: "rating", isNps: true, scale: 10, display: "number" });
                      else setQ(i, { type: v as SurveyQuestionDraft["type"], isNps: false, ...(v === "rating" ? { scale: 5, display: "number" as const } : {}), ...(v.endsWith("choice") && !q.choices?.length ? { choices: ["Option 1", "Option 2"] } : {}) });
                    }}
                    className="w-full"
                  >
                    <option value="open">Open text</option>
                    <option value="rating">Rating</option>
                    <option value="nps">NPS (0–10)</option>
                    <option value="single_choice">Single choice</option>
                    <option value="multiple_choice">Multiple choice</option>
                  </Select>
                )}
              </Field>
              {q.type === "rating" && !q.isNps && (
                <div className="flex flex-wrap items-end gap-3 sm:col-span-2">
                  <Field label="Scale">
                    {(id) => (
                      <Select id={id} value={String(q.scale ?? 5)} disabled={readOnly} onChange={(e) => setQ(i, { scale: Number(e.target.value) as 3 | 5 | 7 | 10 })}>
                        {[3, 5, 7, 10].map((n) => (
                          <option key={n} value={n}>
                            1–{n}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <Field label="Show as">
                    {(id) => (
                      <Select id={id} value={q.display ?? "number"} disabled={readOnly} onChange={(e) => setQ(i, { display: e.target.value as "number" | "emoji" })}>
                        <option value="number">Numbers</option>
                        <option value="emoji" disabled={![3, 5].includes(q.scale ?? 5)}>
                          Emoji (3 or 5 point)
                        </option>
                      </Select>
                    )}
                  </Field>
                  <Field label="Low label">{(id) => <Input id={id} value={q.lowerBoundLabel ?? ""} disabled={readOnly} onChange={(e) => setQ(i, { lowerBoundLabel: e.target.value })} className="w-32" />}</Field>
                  <Field label="High label">{(id) => <Input id={id} value={q.upperBoundLabel ?? ""} disabled={readOnly} onChange={(e) => setQ(i, { upperBoundLabel: e.target.value })} className="w-32" />}</Field>
                </div>
              )}
              {(q.type === "single_choice" || q.type === "multiple_choice") && (
                <div className="sm:col-span-2">
                  <Field label="Choices (one per line)">
                    {(id) => (
                      <textarea
                        id={id}
                        rows={4}
                        value={(q.choices ?? []).join("\n")}
                        disabled={readOnly}
                        onChange={(e) => setQ(i, { choices: e.target.value.split("\n") })}
                        className="w-full rounded-lg border border-line bg-panel px-2.5 py-2 text-[13px]"
                      />
                    )}
                  </Field>
                </div>
              )}
              <label className="flex items-center gap-2 text-[12px] text-ink-2 sm:col-span-2">
                <input type="checkbox" checked={Boolean(q.optional)} disabled={readOnly} onChange={(e) => setQ(i, { optional: e.target.checked })} /> Optional (people can skip it)
              </label>
            </div>
          </Section>
        ))}
        {!readOnly && (
          <div className="flex flex-wrap items-center gap-2">
            {d.questions.length < 10 && (
              <Button variant="ghost" onClick={() => setD({ ...d, questions: [...d.questions, { id: rid(), type: "open", question: "" }] })}>
                <Plus size={13} /> Add question
              </Button>
            )}
            <span className="flex-1" />
            {saved && <span className="text-[12px] text-pos">Saved</span>}
            <Button
              variant="primary"
              loading={saving}
              onClick={() => void save()}
              disabled={!d.name.trim() || d.questions.some((q) => !q.question.trim())}
            >
              {initial ? "Save changes" : "Create survey"}
            </Button>
          </div>
        )}
        {err != null && <ErrorBox error={err} />}
      </div>
      <div className="lg:sticky lg:top-4 lg:self-start">
        <p className="mb-2 text-[12px] text-ink-3">Preview (first question)</p>
        <Preview q={d.questions[0]} />
      </div>
    </div>
  );
}

function Preview({ q }: { q?: SurveyQuestionDraft }) {
  if (!q) return null;
  const scale = q.isNps ? 11 : (q.scale ?? 5);
  const emoji = ["😞", "🙁", "😐", "🙂", "😍"];
  return (
    <div className="rounded-xl border border-line bg-white p-4 text-[#09090b] shadow-lg">
      <p className="text-[14px] font-semibold">{q.question || "Your question"}</p>
      {q.type === "open" && <div className="mt-3 h-16 rounded-lg border border-[#e4e4e7]" />}
      {q.type === "rating" && (
        <>
          <div className="mt-3 flex gap-1">
            {q.display === "emoji" && !q.isNps
              ? (scale === 3 ? [emoji[0], emoji[2], emoji[4]] : emoji).map((e, i) => (
                  <span key={i} className="flex-1 rounded-md bg-[#f4f4f5] py-1.5 text-center text-[16px]">
                    {e}
                  </span>
                ))
              : Array.from({ length: scale }, (_, i) => (
                  <span key={i} className="flex-1 rounded-md bg-[#f4f4f5] py-1.5 text-center text-[11px] tabular-nums">
                    {q.isNps ? i : i + 1}
                  </span>
                ))}
          </div>
          <div className="mt-1 flex justify-between text-[11px] text-[#71717a]">
            <span>{q.lowerBoundLabel}</span>
            <span>{q.upperBoundLabel}</span>
          </div>
        </>
      )}
      {(q.type === "single_choice" || q.type === "multiple_choice") && (
        <div className="mt-3 space-y-1.5">
          {(q.choices ?? []).filter(Boolean).map((c) => (
            <div key={c} className="flex items-center gap-2 rounded-md border border-[#e4e4e7] px-2.5 py-1.5 text-[13px]">
              <span className={cx("h-3 w-3 border border-[#a1a1aa]", q.type === "single_choice" ? "rounded-full" : "rounded-sm")} />
              {c}
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 rounded-md bg-[#18181b] py-1.5 text-center text-[13px] text-white">Submit</div>
    </div>
  );
}

function Results({ r, survey }: { r: SurveyResults | null; survey: SurveyRow }) {
  if (!r) return null;
  if (!r.shown && !r.responses) {
    return (
      <Section>
        <div className="p-4">
          <Empty title="No one has seen this survey yet">
            It shows to users of an app running posthog-js pointed at HostPog{survey.urlContains ? `, on pages containing “${survey.urlContains}”` : ""}. Responses appear here within a minute.
          </Empty>
        </div>
      </Section>
    );
  }
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Shown to" value={fmtInt(r.shown)} hint="unique users" />
        <Stat label="Responses" value={fmtInt(r.responses)} />
        <Stat label="Response rate" value={pct(r.shown ? r.responses / r.shown : null, 0)} />
        <Stat label="Dismissed" value={fmtInt(r.dismissed)} />
      </div>
      {r.questions.map((q) => (
        <Section key={q.id} title={q.question}>
          <div className="p-5">
            <QuestionView q={q} />
          </div>
        </Section>
      ))}
      <p className="text-[12px] text-ink-3">Data from {r.source.label}. Showing up to 200 latest responses per question.</p>
    </div>
  );
}

function QuestionView({ q }: { q: QuestionResult }) {
  if (q.type === "open") {
    if (!q.answers.length) return <p className="text-[13px] text-ink-3">No answers yet.</p>;
    return (
      <ul className="divide-y divide-line">
        {q.answers.map((a, i) => (
          <li key={i} className="py-2.5 text-[13px]">
            <p>{a.text}</p>
            <p className="mt-0.5 text-[11px] text-ink-3">
              {a.distinctId} · {fmtRelative(a.at)}
            </p>
          </li>
        ))}
      </ul>
    );
  }
  const max = Math.max(1, ...q.distribution.map((d) => d.count));
  return (
    <div className="space-y-3">
      {q.type === "rating" && (
        <div className="flex gap-6 text-[13px]">
          {q.nps !== null && (
            <p>
              <span className="text-[24px] font-semibold tabular-nums">{q.nps}</span> <span className="text-ink-3">NPS</span>
            </p>
          )}
          {q.average !== null && (
            <p>
              <span className="text-[24px] font-semibold tabular-nums">{q.average.toFixed(1)}</span> <span className="text-ink-3">average</span>
            </p>
          )}
          <p>
            <span className="text-[24px] font-semibold tabular-nums">{q.answered}</span> <span className="text-ink-3">answers</span>
          </p>
        </div>
      )}
      <div className={q.type === "rating" ? "flex h-32 items-end gap-1" : "space-y-1.5"}>
        {q.distribution.map((d) =>
          q.type === "rating" ? (
            <div key={d.value} className="flex flex-1 flex-col items-center gap-1">
              <span className="text-[11px] tabular-nums text-ink-3">{d.count || ""}</span>
              <div className="w-full rounded-t bg-brand/70" style={{ height: `${(d.count / max) * 90}px` }} />
              <span className="text-[11px] tabular-nums text-ink-3">{d.value}</span>
            </div>
          ) : (
            <div key={d.value} className="flex items-center gap-3 text-[13px]">
              <span className="w-40 truncate">{d.value}</span>
              <div className="h-2 flex-1 rounded-full bg-panel-2">
                <div className="h-2 rounded-full bg-brand/70" style={{ width: `${(d.count / max) * 100}%` }} />
              </div>
              <span className="w-10 text-right tabular-nums text-ink-3">{d.count}</span>
            </div>
          ),
        )}
      </div>
    </div>
  );
}
