"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ExternalLink, Play, RotateCcw, Square, Trash2, Trophy } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { pct, SetupCode, Stat, StatusBadge } from "@/components/products/shared";
import type { ExperimentDetail, VariantResult } from "@/components/products/types";
import { useProject } from "@/components/project-context";
import { RowMenu } from "@/components/row-menu";
import { Badge, Button, cx, ErrorBox, PageHeader, Section, Spinner, Table, Td, Th } from "@/components/ui";
import { apiGet, apiSend } from "@/lib/api";
import { fmtInt, fmtRelative } from "@/lib/format";

export default function ExperimentPage() {
  const p = useProject();
  const qc = useQueryClient();
  const router = useRouter();
  const { experimentId } = useParams<{ experimentId: string }>();
  const url = `/api/v1/projects/${p.projectId}/experiments/${experimentId}`;
  const q = useQuery({
    queryKey: ["experiment", experimentId, p.sourceId],
    queryFn: () => apiGet<ExperimentDetail>(`${url}${p.sourceId ? `?source=${p.sourceId}` : ""}`),
    refetchInterval: (s) => (s.state.data?.experiment.status === "running" ? 30_000 : false),
  });
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<unknown>(null);
  const act = async (action: "start" | "stop" | "ship" | "reset", variant?: string) => {
    setBusy(action);
    setErr(null);
    try {
      await apiSend(url, "PATCH", { action, variant });
      await qc.invalidateQueries({ queryKey: ["experiment", experimentId] });
      await qc.invalidateQueries({ queryKey: ["experiments", p.projectId] });
      await qc.invalidateQueries({ queryKey: ["flags", p.projectId] });
    } catch (e) {
      setErr(e);
    } finally {
      setBusy(null);
    }
  };

  if (q.isLoading) return <Spinner />;
  if (q.error || !q.data) return <ErrorBox error={q.error} />;
  const { experiment: e, flag, results } = q.data;
  const member = p.can("member");
  const winner = results?.winner;
  const totalExposed = results?.variants.reduce((a, v) => a + v.exposed, 0) ?? 0;

  // the one action that fits the current state
  const primary =
    !member ? null : e.status === "draft" ? (
      <Button variant="primary" loading={busy === "start"} onClick={() => act("start")}>
        <Play size={13} /> Launch
      </Button>
    ) : e.status === "running" ? (
      <Button loading={busy === "stop"} onClick={() => confirm("Stop the experiment? Users keep their current variant until you ship one.") && act("stop")}>
        <Square size={12} /> Stop
      </Button>
    ) : winner && !e.shippedVariant ? (
      <Button variant="primary" loading={busy === "ship"} onClick={() => act("ship", winner)}>
        <Trophy size={13} /> Ship “{winner}”
      </Button>
    ) : null;

  return (
    <div className="mx-auto max-w-[1100px] space-y-5">
      <Link href={p.href("experiments")} className="inline-flex items-center gap-1 text-[13px] text-ink-3 hover:text-ink">
        <ArrowLeft size={13} /> Experiments
      </Link>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {e.name} <StatusBadge status={e.status} />
          </span>
        }
        description={e.hypothesis || undefined}
        actions={
          <div className="flex items-center gap-2">
            {primary}
            {member && (
              <RowMenu
                items={[
                  { label: "Open flag", icon: <ExternalLink size={14} />, onSelect: () => router.push(p.href(`flags/${flag.id}`)) },
                  ...flag.variants
                    .filter((v) => e.status !== "draft" && v.key !== e.shippedVariant)
                    .map((v) => ({ label: `Ship “${v.key}” to everyone`, icon: <Trophy size={14} />, onSelect: () => confirm(`Give everyone "${v.key}" and stop the experiment?`) && void act("ship", v.key) })),
                  { label: "Reset to draft", icon: <RotateCcw size={14} />, onSelect: () => confirm("Reset? Results start counting again from the next launch.") && void act("reset"), hidden: e.status === "draft" },
                  {
                    label: "Delete experiment",
                    icon: <Trash2 size={14} />,
                    danger: true,
                    onSelect: async () => {
                      if (!confirm(`Delete "${e.name}"? Its flag is kept.`)) return;
                      try {
                        await apiSend(url, "DELETE");
                        await qc.invalidateQueries({ queryKey: ["experiments", p.projectId] });
                        router.push(p.href("experiments"));
                      } catch (x) {
                        setErr(x);
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

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Goal" value={<span className="font-mono text-[15px]">{e.goalEvent}</span>} />
        <Stat label="Flag" value={<span className="font-mono text-[15px]">{flag.key}</span>} hint={flag.variants.map((v) => `${v.key} ${v.rolloutPercent}%`).join(" · ")} />
        <Stat label="Exposed users" value={fmtInt(totalExposed)} hint={e.startedAt ? `since ${fmtRelative(e.startedAt)}` : "not launched"} />
        <Stat label={e.shippedVariant ? "Shipped" : "Leader"} value={e.shippedVariant ?? winner ?? "–"} tone={winner || e.shippedVariant ? "pos" : undefined} />
      </div>

      {e.status === "draft" ? (
        <Section>
          <div className="space-y-2 p-5 text-[13px] text-ink-2">
            <p className="font-medium text-ink">Ready to launch</p>
            <p>
              Launching turns on the flag <code>{flag.key}</code>: users are split {flag.variants.map((v) => `${v.rolloutPercent}% ${v.key}`).join(" / ")} and results start counting. Add the code below first so users see their variant.
            </p>
          </div>
        </Section>
      ) : results ? (
        <>
          <div className={cx("rounded-xl border px-4 py-3 text-[13px]", results.significant ? "border-pos/30 bg-pos/5" : "border-line bg-panel")}>
            <p className="font-medium">{results.verdict}</p>
            {q.data.source && <p className="mt-0.5 text-[12px] text-ink-3">Data from {q.data.source.label}. Updates every 30 seconds while running.</p>}
          </div>
          <Section title="Results by variant">
            <Table>
              <thead>
                <tr>
                  <Th>Variant</Th>
                  <Th className="text-right">Exposed</Th>
                  <Th className="text-right">Converted</Th>
                  <Th>Conversion rate (95% range)</Th>
                  <Th className="text-right">vs control</Th>
                  <Th>Chance to be best</Th>
                </tr>
              </thead>
              <tbody>
                {results.variants.map((v) => (
                  <VariantRow key={v.key} v={v} control={q.data.control === v.key} max={Math.max(...results.variants.map((x) => x.interval[1]), 0.01)} winner={winner === v.key} />
                ))}
              </tbody>
            </Table>
          </Section>
        </>
      ) : null}

      <SetupCode
        title="Code for this experiment"
        code={(sdk, { init }) => {
          const c = sdk === "posthog" ? "posthog" : "hostpog";
          const test = flag.variants.find((v) => v.key !== (q.data.control ?? "control"))?.key ?? "test";
          return `${init}\n\n// 1. show each user their variant (this also records the exposure)\nif (${c}.getFeatureFlag("${flag.key}") === "${test}") {\n  // new version\n} else {\n  // control\n}\n\n// 2. record the goal when it happens\n${c}.capture("${e.goalEvent}");`;
        }}
        note={
          <>
            Results count users who saw a variant (<code>$feature_flag_called</code>) and then did <code>{e.goalEvent}</code>. Each user keeps the same variant every visit.
          </>
        }
      />
    </div>
  );
}

function VariantRow({ v, control, max, winner }: { v: VariantResult; control: boolean; max: number; winner: boolean }) {
  const scale = (x: number) => `${Math.min(100, (x / max) * 100)}%`;
  return (
    <tr>
      <Td>
        <span className="flex items-center gap-1.5 font-mono text-[13px]">
          {v.key}
          {control && <Badge>control</Badge>}
          {winner && (
            <Badge tone="pos">
              <Trophy size={11} className="mr-1 inline" />
              winner
            </Badge>
          )}
        </span>
      </Td>
      <Td className="text-right tabular-nums">{fmtInt(v.exposed)}</Td>
      <Td className="text-right tabular-nums">{fmtInt(v.converted)}</Td>
      <Td>
        <div className="flex items-center gap-3">
          <span className="w-14 tabular-nums">{pct(v.rate)}</span>
          <div className="relative h-2 w-40 rounded-full bg-panel-2" aria-hidden>
            <div className="absolute top-0 h-2 rounded-full bg-brand/30" style={{ left: scale(v.interval[0]), width: `calc(${scale(v.interval[1])} - ${scale(v.interval[0])})` }} />
            <div className="absolute -top-0.5 h-3 w-0.5 rounded bg-brand" style={{ left: scale(v.rate) }} />
          </div>
          <span className="text-[11px] text-ink-3 tabular-nums">
            {pct(v.interval[0])}–{pct(v.interval[1])}
          </span>
        </div>
      </Td>
      <Td className={cx("text-right tabular-nums", v.lift !== null && v.lift > 0 && "text-pos", v.lift !== null && v.lift < 0 && "text-neg")}>{v.lift === null ? "–" : `${v.lift >= 0 ? "+" : ""}${(v.lift * 100).toFixed(1)}%`}</Td>
      <Td>
        <div className="flex items-center gap-2">
          <div className="h-2 w-24 rounded-full bg-panel-2" aria-hidden>
            <div className={cx("h-2 rounded-full", v.chanceToBeBest >= 0.95 ? "bg-pos" : "bg-ink-3/50")} style={{ width: `${v.chanceToBeBest * 100}%` }} />
          </div>
          <span className="tabular-nums">{pct(v.chanceToBeBest, 0)}</span>
        </div>
      </Td>
    </tr>
  );
}
