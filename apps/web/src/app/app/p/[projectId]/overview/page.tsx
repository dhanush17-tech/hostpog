"use client";
import type { FunnelQuery, SummaryResult, TopValuesResult, TrendResult, FunnelResult } from "@hostpog/contracts";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowUpRight, MousePointerClick, UserPlus, Users } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { EventInput, QueryState } from "@/components/analytics-controls";
import { FunnelBars, TopTable, TrendView } from "@/components/insight-views";
import { useProject } from "@/components/project-context";
import { Provenance } from "@/components/provenance";
import { LivePanel } from "@/components/products/live-panel";
import { HomeHero, HomeShortcuts } from "@/components/home-hero";
import { SetupGuide } from "@/components/setup-guide";
import { Button, Section, Skeleton } from "@/components/ui";
import { apiGet, useAnalytics } from "@/lib/api";
import { delta, fmtInt, fmtRelative, withParam } from "@/lib/format";

function Kpi({ label, value, prev, hint, icon: Icon, loading }: { label: string; value: number | null; prev: number | null; hint?: string; icon: typeof Users; loading?: boolean }) {
  const d = value !== null && prev !== null && prev > 0 ? delta(value, prev) : null;
  const up = d?.value !== null && d?.value !== undefined && d.value >= 0;
  return (
    <div className="rounded-xl border border-line bg-panel p-5 shadow-card">
      <div className="flex items-center justify-between">
        <p className="text-[13px] font-medium text-ink-2" title={hint}>
          {label}
        </p>
        <Icon size={16} className="text-ink-3" aria-hidden />
      </div>
      {loading ? (
        <div className="mt-3 space-y-2">
          <Skeleton className="h-7 w-24" />
          <Skeleton className="h-3 w-32" />
        </div>
      ) : (
        <>
          <p className="tnum mt-2 text-[28px] font-semibold leading-tight tracking-tight">{fmtInt(value)}</p>
          <p className="tnum mt-1 flex items-center gap-1.5 text-[12px] text-ink-3">
            {d && d.value !== null ? (
              <span className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-px font-medium ${up ? "bg-[color-mix(in_srgb,var(--pos)_10%,transparent)] text-pos" : "bg-[color-mix(in_srgb,var(--neg)_10%,transparent)] text-neg"}`}>
                {up ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                {d.label.replace(/^[+-]/, "")}
              </span>
            ) : null}
            {d && d.value !== null ? "vs previous period" : "No prior period to compare"}
          </p>
        </>
      )}
    </div>
  );
}

function FunnelPanel() {
  const p = useProject();
  const key = `hostpog:overview-funnel:${p.projectId}:${p.sourceId}`;
  const [steps, setSteps] = useState<string[]>([]);
  const [draft, setDraft] = useState<string[]>(["", ""]);
  useEffect(() => {
    try {
      setSteps(JSON.parse(localStorage.getItem(key) ?? "[]"));
    } catch {
      setSteps([]);
    }
  }, [key]);
  const q: FunnelQuery | null =
    steps.length >= 2 ? { kind: "funnel", steps: steps.map((e) => ({ event: e, filters: [] })), windowSeconds: 14 * 86400, dateRange: { from: p.range, to: "now" }, filters: [] } : null;
  const f = useAnalytics(p.projectId, p.sourceId, q);
  return (
    <Section
      title="Activation funnel"
      actions={
        steps.length >= 2 && (
          <Button size="sm" variant="ghost" onClick={() => setSteps([])}>
            Edit
          </Button>
        )
      }
    >
      {steps.length < 2 ? (
        <div className="space-y-2 px-5 pt-1 pb-5">
          <p className="text-[13px] text-ink-2">Choose the steps that define activation.</p>
          {draft.map((d, i) => (
            <EventInput key={i} label={`Step ${i + 1}`} value={d} onChange={(v) => setDraft(draft.map((x, j) => (j === i ? (v ?? "") : x)))} className="w-full" />
          ))}
          <div className="flex gap-2">
            {draft.length < 5 && (
              <Button size="sm" variant="ghost" onClick={() => setDraft([...draft, ""])}>
                Add step
              </Button>
            )}
            <Button
              size="sm"
              variant="primary"
              disabled={draft.filter(Boolean).length < 2}
              onClick={() => {
                const s = draft.filter(Boolean);
                localStorage.setItem(key, JSON.stringify(s));
                setSteps(s);
              }}
            >
              Show funnel
            </Button>
          </div>
        </div>
      ) : (
        <QueryState q={f}>
          {f.data && <FunnelBars result={f.data.result as FunnelResult} />}
          <Provenance env={f.data} />
        </QueryState>
      )}
    </Section>
  );
}

export default function Overview() {
  const p = useProject();
  const dr = { from: p.range, to: "now" };
  const interval = p.range === "-24h" ? "hour" : "day";
  const summary = useAnalytics(p.projectId, p.sourceId, p.sourceId ? { kind: "summary", dateRange: dr } : null);
  const trend = useAnalytics(
    p.projectId,
    p.sourceId,
    p.sourceId
      ? { kind: "trend", series: [{ event: null, math: "total", label: "Events", filters: [] }, { event: null, math: "unique_users", label: "Unique users", filters: [] }], interval, dateRange: dr, compare: false, filters: [] }
      : null,
  );
  const top = useAnalytics(p.projectId, p.sourceId, p.sourceId ? { kind: "top", event: null, groupBy: { type: "event_name", key: "$event", limit: 10 }, dateRange: dr, filters: [], limit: 10 } : null);
  const inv = useQuery({
    queryKey: ["investigations", p.projectId],
    queryFn: () => apiGet<{ investigations: { id: string; title: string; status: string; createdAt: string }[] }>(`/api/v1/projects/${p.projectId}/investigations`),
  });
  const s = summary.data?.result as SummaryResult | undefined;

  return (
    <div className="mx-auto max-w-[1280px]">
      <HomeHero />
      <div className="mt-8 space-y-5">
        {!p.sourcesLoading && !p.source ? (
          <QueryState q={summary}>{null}</QueryState>
        ) : summary.error ? (
          <QueryState q={summary}>{null}</QueryState>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Kpi icon={Users} label="Unique users" hint="Distinct people with any event in the range" value={s?.uniqueUsers ?? null} prev={s?.previous.uniqueUsers ?? null} loading={summary.isLoading} />
            <Kpi icon={UserPlus} label="New users" hint="People first seen in the range" value={s?.newUsers ?? null} prev={s?.previous.newUsers ?? null} loading={summary.isLoading} />
            <Kpi icon={MousePointerClick} label="Events" value={s?.events ?? null} prev={s?.previous.events ?? null} loading={summary.isLoading} />
          </div>
        )}
        <SetupGuide />
        <HomeShortcuts />
        <Section title="Activity">
          <QueryState q={trend} height={300}>
            {trend.data && <div className="px-2 pt-2">
              <TrendView result={trend.data.result as TrendResult} />
            </div>}
            <Provenance env={trend.data} />
          </QueryState>
        </Section>
        <div className="grid gap-5 lg:grid-cols-2">
          <FunnelPanel />
          <Section title="Top events">
            <QueryState q={top}>
              {top.data && <TopTable result={top.data.result as TopValuesResult} label="Event" />}
              <Provenance env={top.data} />
            </QueryState>
          </Section>
        </div>
        <LivePanel />
        <Section
          title="Recent investigations"
          actions={
            <Link href={p.href("investigations")} className="text-[12px] font-medium text-ink-2 hover:text-ink">
              View all
            </Link>
          }
        >
          <ul className="divide-y divide-line">
            {(inv.data?.investigations ?? []).slice(0, 5).map((i) => (
              <li key={i.id}>
                <Link href={withParam(p.href("investigations"), "id", i.id)} className="flex items-center justify-between gap-3 px-5 py-2.5 text-[13px] hover:bg-panel-2">
                  <span className="truncate">{i.title}</span>
                  <span className="shrink-0 text-[12px] text-ink-3">
                    {i.status} · {fmtRelative(i.createdAt)}
                  </span>
                </Link>
              </li>
            ))}
            {inv.data && !inv.data.investigations.length && <li className="px-5 py-4 text-[13px] text-ink-3">No investigations yet.</li>}
          </ul>
        </Section>
      </div>
    </div>
  );
}
