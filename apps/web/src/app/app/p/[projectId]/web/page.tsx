"use client";
import type { WebStatsResult } from "@hostpog/contracts";
import { QueryState } from "@/components/analytics-controls";
import { TopTable } from "@/components/insight-views";
import { useProject } from "@/components/project-context";
import { PageHeader, Section } from "@/components/ui";
import { useAnalytics } from "@/lib/api";
import { fmtInt, fmtPct } from "@/lib/format";

export default function Web() {
  const p = useProject();
  const q = useAnalytics(p.projectId, p.sourceId, p.sourceId ? { kind: "web", dateRange: { from: p.range, to: "now" } } : null);
  const r = q.data?.result as WebStatsResult | undefined;
  const panels: [string, keyof WebStatsResult, string][] = [
    ["Top pages", "topPages", "Path"],
    ["Entry pages", "entryPages", "Path"],
    ["Referrers", "referrers", "Domain"],
    ["UTM sources", "utmSources", "utm_source"],
    ["Browsers", "browsers", "Browser"],
    ["Devices", "devices", "Device"],
  ];
  return (
    <div className="mx-auto max-w-[1280px]">
      <PageHeader title="Web analytics" description="Traffic, pages and acquisition." />
      <QueryState q={q} empty={Boolean(r) && r!.pageviews === 0}>
        {r && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                {[
                  ["Visitors", fmtInt(r.visitors)],
                  ["Pageviews", fmtInt(r.pageviews)],
                  ["Sessions", fmtInt(r.sessions)],
                  ["Bounce rate", fmtPct(r.bounceRate)],
                ].map(([k, v]) => (
                  <div key={k} className="rounded-xl border border-line bg-panel p-5 shadow-card">
                    <p className="text-[13px] font-medium text-ink-2" title={k === "Bounce rate" ? r.bounceDefinition : undefined}>
                      {k}
                    </p>
                    <p className="tnum mt-2 text-[28px] font-semibold leading-tight tracking-tight">{v}</p>
                  </div>
                ))}
            </div>
            <div className="grid gap-5 lg:grid-cols-2">
              {panels.map(([title, key, label]) => (
                <Section key={key} title={title}>
                  <TopTable result={{ rows: r[key] as WebStatsResult["topPages"] }} label={label} valueLabel={key === "entryPages" ? "Sessions" : "Pageviews"} />
                </Section>
              ))}
            </div>
          </div>
        )}
      </QueryState>
    </div>
  );
}
