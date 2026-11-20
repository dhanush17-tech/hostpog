"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ExternalLink, Plus, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { EventInput } from "@/components/analytics-controls";
import { StatusBadge } from "@/components/products/shared";
import type { ExperimentRow } from "@/components/products/types";
import { useProject } from "@/components/project-context";
import { RowMenu } from "@/components/row-menu";
import { Button, Empty, ErrorBox, Field, Input, PageHeader, Section, Spinner, Table, Td, Th } from "@/components/ui";
import { apiGet, apiSend } from "@/lib/api";
import { fmtRelative } from "@/lib/format";

export default function Experiments() {
  const p = useProject();
  const qc = useQueryClient();
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const base = `/api/v1/projects/${p.projectId}/experiments`;
  const q = useQuery({ queryKey: ["experiments", p.projectId], queryFn: () => apiGet<{ experiments: ExperimentRow[] }>(base) });
  const list = q.data?.experiments ?? [];
  const member = p.can("member");
  const newButton = member && !creating && (
    <Button variant="primary" onClick={() => setCreating(true)}>
      <Plus size={14} /> New experiment
    </Button>
  );

  return (
    <div className="mx-auto max-w-[1100px] space-y-5">
      <PageHeader title="Experiments" description="Test a change on part of your users and see whether it moves the number you care about." actions={list.length > 0 && newButton} />
      {err != null && <ErrorBox error={err} />}
      {creating && <CreateExperiment onCancel={() => setCreating(false)} onCreated={(id) => router.push(p.href(`experiments/${id}`))} />}
      {q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : !list.length ? (
        !creating && (
          <Section>
            <div className="p-4">
              <Empty title="No experiments yet" action={newButton}>
                Pick a goal (like <code>signed_up</code>), and HostPog splits users between control and a test version, then tells you which one wins.
              </Empty>
            </div>
          </Section>
        )
      ) : (
        <Section>
          <Table>
            <thead>
              <tr>
                <Th>Experiment</Th>
                <Th>Status</Th>
                <Th>Goal</Th>
                <Th>Flag</Th>
                <Th className="text-right">Started</Th>
                <Th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {list.map((e) => (
                <tr key={e.id} className="cursor-pointer hover:bg-panel-2" onClick={() => router.push(p.href(`experiments/${e.id}`))}>
                  <Td className="font-medium">{e.name}</Td>
                  <Td>
                    <StatusBadge status={e.status} />
                  </Td>
                  <Td className="font-mono text-[12px]">{e.goalEvent}</Td>
                  <Td className="font-mono text-[12px] text-ink-3">{e.flagKey}</Td>
                  <Td className="text-right text-[12px] text-ink-3">{e.startedAt ? fmtRelative(e.startedAt) : "not started"}</Td>
                  <Td onClick={(ev) => ev.stopPropagation()}>
                    {member && (
                      <RowMenu
                        label={`Actions for ${e.name}`}
                        items={[
                          { label: "Open flag", icon: <ExternalLink size={14} />, onSelect: () => router.push(p.href(`flags/${e.flagId}`)) },
                          {
                            label: "Delete",
                            icon: <Trash2 size={14} />,
                            danger: true,
                            onSelect: async () => {
                              if (!confirm(`Delete "${e.name}"? Its flag is kept.`)) return;
                              try {
                                await apiSend(`${base}/${e.id}`, "DELETE");
                                await qc.invalidateQueries({ queryKey: ["experiments", p.projectId] });
                              } catch (x) {
                                setErr(x);
                              }
                            },
                          },
                        ]}
                      />
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Section>
      )}
    </div>
  );
}

function CreateExperiment({ onCancel, onCreated }: { onCancel: () => void; onCreated: (id: string) => void }) {
  const p = useProject();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [hypothesis, setHypothesis] = useState("");
  const [goal, setGoal] = useState<string | null>(null);
  const [variants, setVariants] = useState("control, test");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const keys = variants
    .split(",")
    .map((v) => v.trim().replace(/\s+/g, "-"))
    .filter(Boolean);
  const create = async () => {
    setBusy(true);
    setErr(null);
    try {
      const split = keys.map((k, i) => ({ key: k, rolloutPercent: Math.floor(100 / keys.length) + (i < 100 % keys.length ? 1 : 0) }));
      const r = await apiSend<{ experiment: { id: string } }>(`/api/v1/projects/${p.projectId}/experiments`, "POST", { name, hypothesis, goalEvent: goal, variants: split });
      await qc.invalidateQueries({ queryKey: ["experiments", p.projectId] });
      await qc.invalidateQueries({ queryKey: ["flags", p.projectId] });
      onCreated(r.experiment.id);
    } catch (e) {
      setErr(e);
      setBusy(false);
    }
  };
  return (
    <Section title="New experiment">
      <div className="grid gap-4 p-5 sm:grid-cols-2">
        <Field label="Name">{(id) => <Input id={id} autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Shorter signup form" />}</Field>
        <Field label="Goal: the event that counts as a conversion" hint="Users count as converted if they do this after seeing their variant.">
          {() => <EventInput value={goal} onChange={setGoal} label="Goal event" />}
        </Field>
        <Field label="Hypothesis (optional)">{(id) => <Input id={id} value={hypothesis} onChange={(e) => setHypothesis(e.target.value)} placeholder="Fewer fields → more signups" />}</Field>
        <Field label="Variants" hint={`Split evenly: ${keys.map((k) => `${k} ${Math.round(100 / Math.max(keys.length, 1))}%`).join(", ")}. The first one is the control.`}>
          {(id) => <Input id={id} value={variants} onChange={(e) => setVariants(e.target.value)} className="font-mono" />}
        </Field>
        {err != null && (
          <div className="sm:col-span-2">
            <ErrorBox error={err} />
          </div>
        )}
        <div className="flex items-center gap-2 sm:col-span-2">
          <Button variant="primary" loading={busy} disabled={!name.trim() || !goal || keys.length < 2} onClick={create}>
            Create experiment
          </Button>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
          <span className="text-[12px] text-ink-3">Creates a feature flag for it. Nothing changes for users until you launch.</span>
        </div>
      </div>
    </Section>
  );
}
