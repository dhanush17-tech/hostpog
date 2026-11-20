"use client";
import { PROPERTY_MATH, type Interval, type MathType, type PropertyFilter, type TrendQuery, type TrendResult } from "@hostpog/contracts";
import { Plus, X } from "lucide-react";
import { useMemo, useState } from "react";
import { EventInput, FilterEditor, QueryState, SaveInsight, validFilters } from "@/components/analytics-controls";
import { TrendTable, TrendView } from "@/components/insight-views";
import { useProject } from "@/components/project-context";
import { Provenance } from "@/components/provenance";
import { Button, Input, PageHeader, Section, Segmented, Select } from "@/components/ui";
import { useAnalytics } from "@/lib/api";

interface S {
  event: string | null;
  math: MathType;
  /** numeric event property for sum / avg / p95 */
  property?: string;
}

export default function Trends() {
  const p = useProject();
  const [series, setSeries] = useState<S[]>([{ event: "$pageview", math: "total" }]);
  const [interval, setInterval] = useState<Interval>("day");
  const [filters, setFilters] = useState<PropertyFilter[]>([]);
  const [breakdown, setBreakdown] = useState("");
  const [bdType, setBdType] = useState<"event" | "person">("event");
  const [compare, setCompare] = useState(false);
  const [chart, setChart] = useState<"line" | "bar">("line");
  const vf = useMemo(() => validFilters(filters), [filters]);

  const query: TrendQuery | null = p.sourceId
    ? {
        kind: "trend",
        // a property measure without a property yet falls back to a count until one is typed
        series: series.map((s) =>
          PROPERTY_MATH.includes(s.math) && s.property?.trim() ? { event: s.event || null, math: s.math, property: s.property.trim(), filters: [] } : { event: s.event || null, math: PROPERTY_MATH.includes(s.math) ? "total" : s.math, filters: [] },
        ),
        interval,
        dateRange: { from: p.range, to: "now" },
        compare,
        filters: vf,
        ...(breakdown.trim() ? { breakdown: { type: bdType, key: breakdown.trim(), limit: 10 } } : {}),
      }
    : null;
  const q = useAnalytics(p.projectId, p.sourceId, query);
  const r = q.data?.result as TrendResult | undefined;

  return (
    <div className="mx-auto max-w-[1280px]">
      <PageHeader title="Trends" description="Track any event over time." actions={query && <SaveInsight query={query} defaultName={`Trend: ${series.map((s) => s.event ?? "all events").join(", ")}`} />} />
      <Section className="mb-4">
        <div className="space-y-3 p-4">
          {series.map((s, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <span className="w-5 text-[12px] font-medium text-ink-3">{String.fromCharCode(65 + i)}</span>
              <EventInput label={`Series ${i + 1} event`} value={s.event} allowAll onChange={(v) => setSeries(series.map((x, j) => (j === i ? { ...x, event: v } : x)))} />
              <Select aria-label="Measure" value={s.math} onChange={(e) => setSeries(series.map((x, j) => (j === i ? { ...x, math: e.target.value as MathType } : x)))}>
                <option value="total">Total count</option>
                <option value="unique_users">Unique users</option>
                <option value="per_user_avg">Average per user</option>
                <option value="sum">Sum of a property</option>
                <option value="avg">Average of a property</option>
                <option value="p95">95th percentile of a property</option>
              </Select>
              {PROPERTY_MATH.includes(s.math) && (
                <Input
                  aria-label={`Series ${i + 1} property`}
                  placeholder="Numeric property, e.g. revenue"
                  value={s.property ?? ""}
                  onChange={(e) => setSeries(series.map((x, j) => (j === i ? { ...x, property: e.target.value } : x)))}
                  className="w-[220px]"
                />
              )}
              {series.length > 1 && (
                <Button size="sm" variant="ghost" aria-label="Remove series" onClick={() => setSeries(series.filter((_, j) => j !== i))}>
                  <X size={14} />
                </Button>
              )}
            </div>
          ))}
          {series.length < 4 && (
            <Button size="sm" variant="ghost" onClick={() => setSeries([...series, { event: null, math: "total" }])}>
              <Plus size={14} /> Series
            </Button>
          )}
          <FilterEditor filters={filters} onChange={setFilters} />
          <div className="flex flex-wrap items-center gap-3">
            <Segmented
              label="Interval"
              value={interval}
              onChange={setInterval}
              options={[
                { value: "hour", label: "Hour" },
                { value: "day", label: "Day" },
                { value: "week", label: "Week" },
                { value: "month", label: "Month" },
              ]}
            />
            <div className="flex items-center gap-1">
              <Select aria-label="Breakdown property type" value={bdType} onChange={(e) => setBdType(e.target.value as "event" | "person")}>
                <option value="event">Break down by event property</option>
                <option value="person">Break down by person property</option>
              </Select>
              <Input aria-label="Breakdown property" className="w-[150px]" placeholder="e.g. $browser" value={breakdown} onChange={(e) => setBreakdown(e.target.value)} />
            </div>
            <label className="flex items-center gap-2 text-[13px] text-ink-2">
              <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} /> Compare to previous period
            </label>
            <Segmented
              label="Chart type"
              value={chart}
              onChange={setChart}
              options={[
                { value: "line", label: "Line" },
                { value: "bar", label: "Bar" },
              ]}
            />
          </div>
        </div>
      </Section>
      <Section>
        <QueryState q={q} height={340} empty={Boolean(r) && r!.series.every((s) => s.total === 0)}>
          {r && (
            <>
              <div className="px-2 pt-3">
                <TrendView result={r} height={320} kind={chart} />
              </div>
              <TrendTable result={r} />
            </>
          )}
          <Provenance env={q.data} />
        </QueryState>
      </Section>
    </div>
  );
}
