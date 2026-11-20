"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, FlaskConical, Plus, Power, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { cleanConditions, ConditionEditor, SetupCode, type Condition } from "@/components/products/shared";
import { useProject } from "@/components/project-context";
import { RowMenu } from "@/components/row-menu";
import { Badge, Button, ErrorBox, Field, Input, PageHeader, Section, Spinner } from "@/components/ui";
import { apiGet, apiSend } from "@/lib/api";
import type { FlagRow } from "@/components/products/types";

interface Draft {
  key: string;
  name: string;
  active: boolean;
  rolloutPercent: number;
  conditions: Condition[];
  variants: { key: string; rolloutPercent: number }[];
  payloads: Record<string, string>;
}

const EMPTY: Draft = { key: "", name: "", active: true, rolloutPercent: 100, conditions: [], variants: [], payloads: {} };

function toDraft(f: FlagRow): Draft {
  return {
    key: f.key,
    name: f.name,
    active: f.active,
    rolloutPercent: f.rolloutPercent,
    conditions: f.conditions as Condition[],
    variants: f.variants,
    payloads: Object.fromEntries(Object.entries(f.payloads).map(([k, v]) => [k, JSON.stringify(v, null, 2)])),
  };
}

function toPayload(d: Draft): { body: Record<string, unknown> | null; error: string | null } {
  const payloads: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(d.payloads)) {
    if (!v.trim()) continue;
    if (d.variants.length > 1 ? !d.variants.some((x) => x.key === k) : k !== "true") continue;
    try {
      payloads[k] = JSON.parse(v);
    } catch {
      return { body: null, error: `The payload for "${k}" isn't valid JSON.` };
    }
  }
  return {
    body: { key: d.key.trim(), name: d.name.trim(), active: d.active, rolloutPercent: d.rolloutPercent, conditions: cleanConditions(d.conditions), variants: d.variants.length > 1 ? d.variants : [], payloads },
    error: null,
  };
}

export default function FlagEditor() {
  const p = useProject();
  const qc = useQueryClient();
  const router = useRouter();
  const { flagId } = useParams<{ flagId: string }>();
  const isNew = flagId === "new";
  const base = `/api/v1/projects/${p.projectId}/flags`;
  const q = useQuery({ queryKey: ["flag", flagId], queryFn: () => apiGet<{ flags: FlagRow[] }>(base), enabled: !isNew });
  const existing = q.data?.flags.find((f) => f.id === flagId);
  const [d, setD] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (existing) setD(toDraft(existing));
  }, [existing]);
  const member = p.can("member");
  const runningExperiment = existing?.experiment?.status === "running";
  const set = (patch: Partial<Draft>) => {
    setSaved(false);
    setD((x) => ({ ...x, ...patch }));
  };
  const variantSum = d.variants.reduce((a, v) => a + (Number(v.rolloutPercent) || 0), 0);
  const multivariate = d.variants.length > 0;
  const dirty = isNew || (existing ? JSON.stringify(d) !== JSON.stringify(toDraft(existing)) : false);

  const save = async () => {
    const { body, error } = toPayload(d);
    if (error) return setErr(new Error(error));
    setSaving(true);
    setErr(null);
    try {
      if (isNew) {
        const r = await apiSend<{ flag: FlagRow }>(base, "POST", body);
        await qc.invalidateQueries({ queryKey: ["flags", p.projectId] });
        router.replace(p.href(`flags/${r.flag.id}`));
      } else {
        await apiSend(`${base}/${flagId}`, "PATCH", body);
        await qc.invalidateQueries({ queryKey: ["flag", flagId] });
        await qc.invalidateQueries({ queryKey: ["flags", p.projectId] });
        setSaved(true);
      }
    } catch (e) {
      setErr(e);
    } finally {
      setSaving(false);
    }
  };

  if (!isNew && q.isLoading) return <Spinner />;
  if (!isNew && !existing) return <ErrorBox error={q.error ?? new Error("Flag not found")} />;

  return (
    <div className="mx-auto max-w-[920px] space-y-5">
      <Link href={p.href("flags")} className="inline-flex items-center gap-1 text-[13px] text-ink-3 hover:text-ink">
        <ArrowLeft size={13} /> Feature flags
      </Link>
      <PageHeader
        title={isNew ? "New feature flag" : <span className="font-mono">{existing!.key}</span>}
        description={isNew ? "Decide who sees a feature. You can change this any time without a deploy." : existing!.name || undefined}
        actions={
          member && (
            <div className="flex items-center gap-2">
              {saved && !dirty && <span className="text-[12px] text-pos">Saved</span>}
              {dirty && (
                <Button variant="primary" loading={saving} onClick={save} disabled={!d.key.trim() || (multivariate && variantSum !== 100)}>
                  {isNew ? "Create flag" : "Save changes"}
                </Button>
              )}
              {!isNew && (
                <RowMenu
                  items={[
                    { label: d.active ? "Turn off" : "Turn on", icon: <Power size={14} />, onSelect: () => set({ active: !d.active }) },
                    {
                      label: "Delete flag",
                      icon: <Trash2 size={14} />,
                      danger: true,
                      onSelect: async () => {
                        if (!confirm(`Delete "${existing!.key}"? Apps checking it will get false.`)) return;
                        try {
                          await apiSend(`${base}/${flagId}`, "DELETE");
                          await qc.invalidateQueries({ queryKey: ["flags", p.projectId] });
                          router.push(p.href("flags"));
                        } catch (e) {
                          setErr(e);
                        }
                      },
                    },
                  ]}
                />
              )}
            </div>
          )
        }
      />
      {err != null && <ErrorBox error={err} />}
      {existing?.experiment && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-brand/30 bg-brand-soft px-4 py-3 text-[13px]">
          <span className="flex items-center gap-2">
            <FlaskConical size={15} className="text-brand" />
            This flag runs the experiment <strong>{existing.experiment.name}</strong>
            {runningExperiment ? ". Changing who gets it while it runs will skew the results." : "."}
          </span>
          <Link href={p.href(`experiments/${existing.experiment.id}`)}>
            <Button size="sm">Open experiment</Button>
          </Link>
        </div>
      )}

      <Section title="Basics">
        <div className="grid gap-4 p-5 sm:grid-cols-2">
          <Field label="Key" hint="What your code checks. Letters, numbers, - and _.">
            {(id) => <Input id={id} value={d.key} disabled={!member} placeholder="new-checkout" onChange={(e) => set({ key: e.target.value.replace(/\s/g, "-") })} className="font-mono" />}
          </Field>
          <Field label="Description" hint="Optional. Shown in the flag list.">
            {(id) => <Input id={id} value={d.name} disabled={!member} placeholder="Redesigned checkout" onChange={(e) => set({ name: e.target.value })} />}
          </Field>
          <label className="flex items-center gap-2 text-[13px] sm:col-span-2">
            <input type="checkbox" checked={d.active} disabled={!member} onChange={(e) => set({ active: e.target.checked })} />
            Flag is on {!d.active && <span className="text-ink-3">(everyone gets false)</span>}
          </label>
        </div>
      </Section>

      <Section title="Who gets it">
        <div className="space-y-4 p-5">
          <div>
            <p className="mb-2 text-[13px] text-ink-2">Users whose person properties match</p>
            <ConditionEditor conditions={d.conditions} onChange={(c) => set({ conditions: c })} disabled={!member} placeholder="email" addLabel="Add a condition" />
            {!d.conditions.length && <p className="mt-1 text-[12px] text-ink-3">No conditions: every user is eligible.</p>}
          </div>
          <div>
            <label className="text-[13px] text-ink-2" htmlFor="rollout">
              Roll out to <strong className="tabular-nums text-ink">{d.rolloutPercent}%</strong> of them
            </label>
            <input id="rollout" type="range" min={0} max={100} step={1} value={d.rolloutPercent} disabled={!member} onChange={(e) => set({ rolloutPercent: Number(e.target.value) })} className="mt-2 w-full accent-[var(--color-brand)]" />
            <p className="text-[12px] text-ink-3">Each user always lands in the same bucket, so raising the percentage only adds people.</p>
          </div>
        </div>
      </Section>

      <Section
        title="Variants"
        actions={
          member &&
          !multivariate && (
            <Button
              size="sm"
              onClick={() =>
                set({
                  variants: [
                    { key: "control", rolloutPercent: 50 },
                    { key: "test", rolloutPercent: 50 },
                  ],
                })
              }
            >
              <Plus size={13} /> Serve variants
            </Button>
          )
        }
      >
        <div className="p-5">
          {!multivariate ? (
            <p className="text-[13px] text-ink-3">Matching users get true. Add variants to serve different versions (e.g. for an A/B test).</p>
          ) : (
            <div className="space-y-2">
              {d.variants.map((v, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    aria-label="Variant key"
                    value={v.key}
                    disabled={!member}
                    onChange={(e) => set({ variants: d.variants.map((x, j) => (j === i ? { ...x, key: e.target.value.replace(/\s/g, "-") } : x)) })}
                    className="w-[200px] font-mono"
                  />
                  <Input
                    aria-label={`${v.key} share`}
                    type="number"
                    min={0}
                    max={100}
                    value={v.rolloutPercent}
                    disabled={!member}
                    onChange={(e) => set({ variants: d.variants.map((x, j) => (j === i ? { ...x, rolloutPercent: Number(e.target.value) } : x)) })}
                    className="w-[90px] tabular-nums"
                  />
                  <span className="text-[13px] text-ink-3">%</span>
                  {member && (
                    <button
                      aria-label="Remove variant"
                      onClick={() => set({ variants: d.variants.length <= 2 ? [] : d.variants.filter((_, j) => j !== i) })}
                      className="rounded p-1 text-ink-3 hover:bg-panel-2 hover:text-ink"
                    >
                      <X size={14} />
                    </button>
                  )}
                </div>
              ))}
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {member && d.variants.length < 10 && (
                  <Button size="sm" variant="ghost" onClick={() => set({ variants: [...d.variants, { key: `variant-${d.variants.length}`, rolloutPercent: 0 }] })}>
                    <Plus size={13} /> Add variant
                  </Button>
                )}
                {member && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      const n = d.variants.length;
                      set({ variants: d.variants.map((v, i) => ({ ...v, rolloutPercent: Math.floor(100 / n) + (i < 100 % n ? 1 : 0) })) });
                    }}
                  >
                    Split evenly
                  </Button>
                )}
                <span className={variantSum === 100 ? "text-[12px] text-ink-3" : "text-[12px] text-neg"}>Total {variantSum}%{variantSum !== 100 && " (needs to be 100%)"}</span>
              </div>
            </div>
          )}
        </div>
      </Section>

      <details className="rounded-xl border border-line bg-panel">
        <summary className="cursor-pointer select-none px-5 py-3 text-[13px] font-medium">Payloads (optional JSON sent with the flag)</summary>
        <div className="space-y-3 border-t border-line p-5">
          {(multivariate ? d.variants.map((v) => v.key) : ["true"]).map((k) => (
            <Field key={k} label={multivariate ? `When the variant is "${k}"` : "When the flag is on"}>
              {(id) => (
                <textarea
                  id={id}
                  rows={3}
                  value={d.payloads[k] ?? ""}
                  disabled={!member}
                  placeholder='{ "buttonColor": "orange" }'
                  onChange={(e) => set({ payloads: { ...d.payloads, [k]: e.target.value } })}
                  className="w-full rounded-lg border border-line bg-panel px-2.5 py-2 font-mono text-[12px]"
                />
              )}
            </Field>
          ))}
        </div>
      </details>

      <TestUser draft={d} />

      <SetupCode
        title="Use this flag"
        code={(sdk, { init }) => {
          const c = sdk === "posthog" ? "posthog" : "hostpog";
          const key = d.key || "my-flag";
          return multivariate
            ? `${init}\n\nconst variant = ${c}.getFeatureFlag("${key}"); // ${d.variants.map((v) => `"${v.key}"`).join(" | ")}\nif (variant === "${d.variants[1]?.key ?? "test"}") {\n  // new version\n}`
            : `${init}\n\nif (${c}.isFeatureEnabled("${key}")) {\n  // new version\n}`;
        }}
      />
    </div>
  );
}

function TestUser({ draft }: { draft: Draft }) {
  const p = useProject();
  const [distinctId, setDistinctId] = useState("");
  const [props, setProps] = useState("");
  const [result, setResult] = useState<{ enabled: boolean; variant?: string; reason: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const body = useMemo(() => toPayload(draft).body, [draft]);
  const reasons: Record<string, string> = {
    match: "Matches the conditions and is inside the rollout.",
    disabled: "The flag is off.",
    condition_mismatch: "Doesn't match the conditions.",
    out_of_rollout: "Matches, but falls outside the rollout percentage.",
  };
  const run = async () => {
    setErr(null);
    let properties: Record<string, unknown> = {};
    if (props.trim()) {
      try {
        properties = JSON.parse(props);
      } catch {
        return setErr('Person properties must be JSON, e.g. { "plan": "pro" }');
      }
    }
    try {
      const r = await apiSend<{ result: { enabled: boolean; variant?: string; reason: string } }>(`/api/v1/projects/${p.projectId}/flags/preview`, "POST", { flag: { ...body, key: body?.key || "preview" }, distinctId, properties });
      setResult(r.result);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <Section title="Test a user">
      <div className="space-y-3 p-5">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="User (distinct id)">{(id) => <Input id={id} value={distinctId} onChange={(e) => setDistinctId(e.target.value)} placeholder="user_123" className="w-[220px]" />}</Field>
          <Field label="Person properties (JSON, optional)">
            {(id) => <Input id={id} value={props} onChange={(e) => setProps(e.target.value)} placeholder='{ "plan": "pro" }' className="w-[280px] font-mono" />}
          </Field>
          <Button onClick={run} disabled={!distinctId.trim()}>
            Check
          </Button>
        </div>
        {err && <p className="text-[12px] text-neg">{err}</p>}
        {result && (
          <p className="flex flex-wrap items-center gap-2 text-[13px]">
            <Badge tone={result.enabled ? "pos" : "neutral"}>{result.variant ?? String(result.enabled)}</Badge>
            <span className="text-ink-2">{reasons[result.reason] ?? result.reason}</span>
          </p>
        )}
      </div>
    </Section>
  );
}
