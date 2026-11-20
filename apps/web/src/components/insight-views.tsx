"use client";
import type { FunnelResult, RetentionResult, TopValuesResult, TrendResult } from "@hostpog/contracts";
import { fmtDuration, fmtInt, fmtPct } from "@/lib/format";
import { LineChart } from "./chart";
import { Table, Td, Th } from "./ui";

export function TrendView({ result, height = 280, kind = "line" }: { result: TrendResult; height?: number; kind?: "line" | "bar" }) {
  const labels = result.series[0]?.points.map((p) => p.t) ?? [];
  const series = [
    ...result.series.map((s) => ({ name: s.label, data: s.points.map((p) => p.v) })),
    ...(result.previous ?? []).map((s) => ({ name: `${s.label} (previous period)`, data: s.points.map((p) => p.v), dashed: true })),
  ];
  return <LineChart labels={labels} series={series} height={height} kind={kind} ariaLabel={`Trend chart: ${result.series.map((s) => s.label).join(", ")}`} />;
}

export function TrendTable({ result }: { result: TrendResult }) {
  return (
    <Table>
      <thead>
        <tr>
          <Th>Series</Th>
          <Th className="text-right">Total</Th>
          {result.previous && <Th className="text-right">Previous</Th>}
          {result.previous && <Th className="text-right">Change</Th>}
        </tr>
      </thead>
      <tbody>
        {result.series.map((s, i) => {
          const prev = result.previous?.[i];
          const d = prev && prev.total ? (s.total - prev.total) / prev.total : null;
          return (
            <tr key={s.label + i}>
              <Td>{s.label}</Td>
              <Td className="tnum text-right">{fmtInt(s.total)}</Td>
              {result.previous && <Td className="tnum text-right">{fmtInt(prev?.total)}</Td>}
              {result.previous && <Td className={`tnum text-right ${d === null ? "" : d >= 0 ? "text-pos" : "text-neg"}`}>{d === null ? "—" : `${d >= 0 ? "+" : ""}${(d * 100).toFixed(1)}%`}</Td>}
            </tr>
          );
        })}
      </tbody>
    </Table>
  );
}

export function FunnelBars({ result, onDrill }: { result: FunnelResult; onDrill?: (step: number, outcome: "reached" | "dropped") => void }) {
  const last = result.steps[result.steps.length - 1];
  return (
    <div className="px-5 pt-2 pb-4">
      <div className="mb-4 flex flex-wrap gap-x-8 gap-y-2">
        <div>
          <p className="text-[12px] text-ink-3">Conversion</p>
          <p className="tnum text-[20px] font-semibold tracking-tight">{last ? fmtPct(last.conversionFromStart) : "—"}</p>
        </div>
        <div>
          <p className="text-[12px] text-ink-3">Median time to convert</p>
          <p className="tnum text-[20px] font-semibold tracking-tight">{fmtDuration(result.medianSecondsToConvert)}</p>
        </div>
      </div>
      <ol className="space-y-3.5">
        {result.steps.map((s, i) => (
          <li key={s.event + i}>
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-[13px]">
              <span className="flex items-center gap-2">
                <span className="flex size-5 items-center justify-center rounded-md bg-panel-2 text-[11px] font-medium text-ink-2">{i + 1}</span>
                <span className="font-medium">{s.label}</span>
              </span>
              <span className="tnum text-ink-3">
                <span className="font-medium text-ink">{fmtInt(s.count)}</span> · {fmtPct(s.conversionFromStart)}
              </span>
            </div>
            <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-panel-2" role="presentation">
              <div className="h-2 rounded-full bg-gradient-to-r from-[#ff9a52] to-[var(--chart-1)]" style={{ width: `${Math.max(s.conversionFromStart * 100, s.count ? 0.5 : 0)}%` }} />
            </div>
            {(onDrill || (i > 0 && s.dropOff > 0)) && (
              <div className="mt-1.5 flex gap-3 text-[12px]">
                {onDrill && (
                  <button className="text-ink-3 hover:text-ink" onClick={() => onDrill(i + 1, "reached")}>
                    View people
                  </button>
                )}
                {i > 0 && s.dropOff > 0 && (
                  <button className="text-neg hover:underline disabled:no-underline" disabled={!onDrill} onClick={() => onDrill?.(i + 1, "dropped")}>
                    {fmtInt(s.dropOff)} dropped off ({fmtPct(1 - s.conversionFromPrevious)})
                  </button>
                )}
              </div>
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function TopTable({ result, label, valueLabel = "Count" }: { result: TopValuesResult; label: string; valueLabel?: string }) {
  const max = Math.max(1, ...result.rows.map((r) => r.count));
  return (
    <Table>
      <thead>
        <tr>
          <Th>{label}</Th>
          <Th className="text-right">{valueLabel}</Th>
          <Th className="text-right">Users</Th>
        </tr>
      </thead>
      <tbody>
        {result.rows.map((r) => (
          <tr key={r.value ?? "(none)"}>
            <Td className="relative max-w-[320px]">
              <div className="absolute inset-y-1.5 left-2 rounded-md bg-brand-soft" style={{ width: `calc(${(r.count / max) * 100}% - 8px)` }} aria-hidden />
              <span className="relative block truncate pl-1 font-medium">{r.value ?? <span className="text-ink-3">(none)</span>}</span>
            </Td>
            <Td className="tnum text-right">{fmtInt(r.count)}</Td>
            <Td className="tnum text-right">{fmtInt(r.uniqueUsers)}</Td>
          </tr>
        ))}
        {!result.rows.length && (
          <tr>
            <Td colSpan={3} className="text-ink-3">
              No data
            </Td>
          </tr>
        )}
      </tbody>
    </Table>
  );
}

export function RetentionMatrix({ result }: { result: RetentionResult }) {
  const n = Math.max(0, ...result.cohorts.map((c) => c.values.length));
  return (
    <Table>
      <thead>
        <tr>
          <Th>Cohort</Th>
          <Th className="text-right">Persons</Th>
          {Array.from({ length: n }, (_, i) => (
            <Th key={i} className="text-right">
              {result.period === "day" ? "Day" : "Week"} {i}
            </Th>
          ))}
        </tr>
      </thead>
      <tbody>
        {result.cohorts.map((c) => (
          <tr key={c.start}>
            <Td className="whitespace-nowrap">{c.start}</Td>
            <Td className="tnum text-right">{fmtInt(c.size)}</Td>
            {c.values.map((v, i) => {
              const pct = v === null || !c.size ? null : v / c.size;
              return (
                <Td key={i} className="tnum text-right" style={pct === null ? undefined : { background: `color-mix(in srgb, var(--chart-1) ${Math.round(4 + pct * 46)}%, transparent)` }}>
                  {pct === null ? <span className="text-ink-3" title="Period not complete">·</span> : fmtPct(pct, 0)}
                </Td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}
