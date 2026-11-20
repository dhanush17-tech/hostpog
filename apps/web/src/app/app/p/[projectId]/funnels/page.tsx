"use client";
import type { FunnelPersonsResult, FunnelQuery, FunnelResult, PropertyFilter } from "@hostpog/contracts";
import { Plus, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { EventInput, FilterEditor, QueryState, SaveInsight, validFilters } from "@/components/analytics-controls";
import { FunnelBars } from "@/components/insight-views";
import { useProject } from "@/components/project-context";
import { Provenance } from "@/components/provenance";
import { Button, Drawer, Input, PageHeader, Section, Select, Spinner, Table, Td, Th, ErrorBox } from "@/components/ui";
import { useAnalytics } from "@/lib/api";
import { fmtInt, fmtPct } from "@/lib/format";

export default function Funnels() {
  const p = useProject();
  const [steps, setSteps] = useState<string[]>(["$pageview", ""]);
  const [windowDays, setWindowDays] = useState(14);
  const [filters, setFilters] = useState<PropertyFilter[]>([]);
  const [breakdown, setBreakdown] = useState("");
  const [drill, setDrill] = useState<{ step: number; outcome: "reached" | "dropped" } | null>(null);
  const vf = useMemo(() => validFilters(filters), [filters]);
  const ready = steps.filter(Boolean).length >= 2;
  const query: FunnelQuery | null =
    p.sourceId && ready
      ? {
          kind: "funnel",
          steps: steps.filter(Boolean).map((e) => ({ event: e, filters: [] })),
          windowSeconds: Math.round(windowDays * 86400),
          dateRange: { from: p.range === "-24h" ? "-7d" : p.range, to: "now" },
          filters: vf,
          ...(breakdown.trim() ? { breakdown: { type: "event", key: breakdown.trim(), limit: 8 } } : {}),
        }
      : null;
  const q = useAnalytics(p.projectId, p.sourceId, query);
  const r = q.data?.result as FunnelResult | undefined;
  const persons = useAnalytics(p.projectId, p.sourceId, query && drill ? { ...query, kind: "funnel_persons", step: drill.step, outcome: drill.outcome, limit: 100 } : null);

  return (
    <div className="mx-auto max-w-[1280px]">
      <PageHeader title="Funnels" description="See where people drop off between steps." actions={query && <SaveInsight query={query} defaultName={`Funnel: ${steps.filter(Boolean).join(" → ")}`} />} />
      <Section className="mb-4">
        <div className="space-y-2 p-4">
          {steps.map((s, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="w-5 text-[12px] font-medium text-ink-3">{i + 1}</span>
              <EventInput label={`Step ${i + 1}`} value={s} onChange={(v) => setSteps(steps.map((x, j) => (j === i ? (v ?? "") : x)))} />
              {steps.length > 2 && (
                <Button size="sm" variant="ghost" aria-label="Remove step" onClick={() => setSteps(steps.filter((_, j) => j !== i))}>
                  <X size={14} />
                </Button>
              )}
            </div>
          ))}
          {steps.length < 8 && (
            <Button size="sm" variant="ghost" onClick={() => setSteps([...steps, ""])}>
              <Plus size={14} /> Step
            </Button>
          )}
          <div className="flex flex-wrap items-center gap-3 pt-1">
            <label className="flex items-center gap-2 text-[13px] text-ink-2">
              Conversion window
              <Select aria-label="Conversion window" value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value))}>
                <option value={1 / 24}>1 hour</option>
                <option value={1}>1 day</option>
                <option value={7}>7 days</option>
                <option value={14}>14 days</option>
                <option value={30}>30 days</option>
              </Select>
            </label>
            <Input aria-label="Breakdown by first-step property" className="w-[220px]" placeholder="Break down by (e.g. $browser)" value={breakdown} onChange={(e) => setBreakdown(e.target.value)} />
          </div>
          <FilterEditor filters={filters} onChange={setFilters} />
        </div>
      </Section>
      <Section>
        {!ready ? (
          <p className="p-4 text-[13px] text-ink-3">Add at least two steps.</p>
        ) : (
          <QueryState q={q} empty={Boolean(r) && r!.steps[0]?.count === 0}>
            {r && <FunnelBars result={r} onDrill={(step, outcome) => setDrill({ step, outcome })} />}
            {r?.breakdowns && (
              <Table>
                <thead>
                  <tr>
                    <Th>{breakdown}</Th>
                    {r.steps.map((s, i) => (
                      <Th key={i} className="text-right">
                        {i + 1}. {s.label}
                      </Th>
                    ))}
                    <Th className="text-right">Overall</Th>
                  </tr>
                </thead>
                <tbody>
                  {r.breakdowns.map((b) => (
                    <tr key={b.value ?? "none"}>
                      <Td>{b.value ?? <span className="text-ink-3">(none)</span>}</Td>
                      {b.steps.map((s, i) => (
                        <Td key={i} className="tnum text-right">
                          {fmtInt(s.count)}
                        </Td>
                      ))}
                      <Td className="tnum text-right">{fmtPct(b.steps[b.steps.length - 1]?.conversionFromStart)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            <Provenance env={q.data} />
          </QueryState>
        )}
      </Section>
      <Drawer open={Boolean(drill)} onClose={() => setDrill(null)} title={drill ? `${drill.outcome === "reached" ? "Reached" : "Dropped before"} step ${drill.step}` : ""}>
        {persons.isLoading && <Spinner />}
        {persons.error && <ErrorBox error={persons.error} />}
        {persons.data && (
          <div className="space-y-3">
            <p className="text-[12px] text-ink-3">{(persons.data.result as FunnelPersonsResult).definition} First 100 shown.</p>
            <ul className="divide-y divide-line rounded-md border border-line">
              {(persons.data.result as FunnelPersonsResult).persons.map((x) => (
                <li key={x.personId} className="flex items-center justify-between px-3 py-2 text-[13px]">
                  <Link className="truncate font-mono text-[12px] hover:underline" href={p.href(`users/${encodeURIComponent(x.personId)}`)}>
                    {x.personId}
                  </Link>
                  <span className="text-[12px] text-ink-3">{x.stepsCompleted} steps</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Drawer>
    </div>
  );
}
