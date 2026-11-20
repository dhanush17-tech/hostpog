"use client";
import { useEffect, useRef } from "react";
import type { EChartsOption } from "echarts";

function cssVar(name: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function palette(): string[] {
  return ["--chart-1", "--chart-2", "--chart-3", "--chart-4", "--chart-5", "--chart-6"].map(cssVar);
}

function hexA(hex: string, a: number) {
  const h = hex.replace("#", "");
  if (h.length !== 6) return hex;
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

function compact(v: number) {
  return Math.abs(v) >= 1000 ? new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v) : String(v);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** "2026-11-03" → "Nov 3", "2026-11-03 14:00" → "14:00" */
function shortLabel(v: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}:\d{2}))?/.exec(v);
  if (!m) return v;
  if (m[4] && m[4] !== "00:00") return m[4];
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}`;
}

export interface LineSeries {
  name: string;
  data: number[];
  dashed?: boolean;
}

/** Thin ECharts wrapper (loaded on the client only), themed from CSS variables. */
export function LineChart({ labels, series, height = 280, kind = "line", ariaLabel }: { labels: string[]; series: LineSeries[]; height?: number; kind?: "line" | "bar"; ariaLabel: string }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => {
    let disposed = false;
    let chart: import("echarts").ECharts | null = null;
    let ro: ResizeObserver | null = null;
    let mo: MutationObserver | null = null;
    void import("echarts").then((echarts) => {
      if (disposed || !el.current) return;
      chart = echarts.init(el.current, undefined, { renderer: "svg" });
      const render = () => {
        const ink2 = cssVar("--ink-3");
        const line = cssVar("--line");
        const colors = palette();
        const opt: EChartsOption = {
          animation: !window.matchMedia("(prefers-reduced-motion: reduce)").matches,
          color: colors,
          textStyle: { fontFamily: "Inter Variable, ui-sans-serif, system-ui, sans-serif" },
          // line charts put the last label on the right edge: leave room so "Nov 15" isn't clipped to "Nov 1"
          grid: { left: 4, right: kind === "line" ? 28 : 12, top: series.length > 1 ? 36 : 12, bottom: 4, containLabel: true },
          tooltip: {
            trigger: "axis",
            backgroundColor: cssVar("--panel"),
            borderColor: line,
            borderWidth: 1,
            padding: [8, 10],
            extraCssText: "border-radius:10px;box-shadow:0 8px 24px rgba(0,0,0,.08)",
            textStyle: { color: cssVar("--ink"), fontSize: 12 },
            axisPointer: { type: kind === "bar" ? "shadow" : "line", lineStyle: { color: cssVar("--line-strong") }, shadowStyle: { color: "rgba(127,127,127,0.06)" } },
            valueFormatter: (v) => (typeof v === "number" ? v.toLocaleString("en-US", { maximumFractionDigits: 2 }) : String(v)),
          },
          legend: series.length > 1 ? { top: 0, left: 0, icon: "circle", itemWidth: 8, itemHeight: 8, itemGap: 16, textStyle: { color: ink2, fontSize: 12 } } : undefined,
          xAxis: {
            type: "category",
            data: labels,
            boundaryGap: kind === "bar",
            axisLine: { show: false },
            axisTick: { show: false },
            axisLabel: { color: ink2, fontSize: 11, hideOverlap: true, margin: 12, formatter: (v: string) => shortLabel(v) },
          },
          yAxis: { type: "value", splitLine: { lineStyle: { color: line, type: [3, 4] } }, axisLabel: { color: ink2, fontSize: 11, formatter: (v: number) => compact(v) } },
          series: series.map((s, i) => {
            const c = colors[i % colors.length] ?? "#f26a12";
            return {
              name: s.name,
              type: kind,
              data: s.data,
              showSymbol: labels.length <= 12, // few points: show them, a smooth line alone suggests data in between
              symbol: "circle",
              symbolSize: 6,
              smooth: labels.length <= 12 ? false : 0.25,
              lineStyle: { width: 2, type: s.dashed ? "dashed" : "solid" },
              areaStyle:
                kind === "line" && i === 0 && !s.dashed
                  ? { color: { type: "linear", x: 0, y: 0, x2: 0, y2: 1, colorStops: [{ offset: 0, color: hexA(c, 0.18) }, { offset: 1, color: hexA(c, 0) }] } }
                  : undefined,
              itemStyle: kind === "bar" ? { borderRadius: [4, 4, 0, 0] } : undefined,
              barMaxWidth: 24,
              emphasis: { focus: "series" },
            };
          }),
        };
        chart?.setOption(opt, true);
      };
      render();
      ro = new ResizeObserver(() => chart?.resize());
      ro.observe(el.current);
      mo = new MutationObserver(render);
      mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    });
    return () => {
      disposed = true;
      ro?.disconnect();
      mo?.disconnect();
      chart?.dispose();
    };
  }, [labels, series, kind]);
  return <div ref={el} role="img" aria-label={ariaLabel} style={{ height, width: "100%" }} />;
}
