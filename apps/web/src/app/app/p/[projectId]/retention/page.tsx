"use client";
import type { RetentionQuery, RetentionResult } from "@hostpog/contracts";
import { useState } from "react";
import { EventInput, QueryState, SaveInsight } from "@/components/analytics-controls";
import { RetentionMatrix } from "@/components/insight-views";
import { useProject } from "@/components/project-context";
import { Provenance } from "@/components/provenance";
import { PageHeader, Section, Segmented } from "@/components/ui";
import { useAnalytics } from "@/lib/api";

export default function Retention() {
  const p = useProject();
  const [start, setStart] = useState<string | null>(null);
  const [ret, setRet] = useState<string | null>(null);
  const [period, setPeriod] = useState<"day" | "week">("day");
  const query: RetentionQuery | null = p.sourceId
    ? { kind: "retention", startEvent: start || null, returnEvent: ret || null, period, periods: period === "day" ? 7 : 6, dateRange: { from: period === "day" ? "-14d" : "-8w", to: "now" } }
    : null;
  const q = useAnalytics(p.projectId, p.sourceId, query);
  const r = q.data?.result as RetentionResult | undefined;
  return (
    <div className="mx-auto max-w-[1280px]">
      <PageHeader title="Retention" description="See how many people come back." actions={query && <SaveInsight query={query} defaultName="Retention" />} />
      <Section className="mb-4">
        <div className="flex flex-wrap items-center gap-3 p-4 text-[13px] text-ink-2">
          Cohort by first <EventInput label="Start event" value={start} onChange={setStart} allowAll /> returning with <EventInput label="Return event" value={ret} onChange={setRet} allowAll />
          <Segmented
            label="Period"
            value={period}
            onChange={setPeriod}
            options={[
              { value: "day", label: "Daily" },
              { value: "week", label: "Weekly" },
            ]}
          />
        </div>
      </Section>
      <Section>
        <QueryState q={q} empty={Boolean(r) && !r!.cohorts.length}>
          {r && (
            <>
              <RetentionMatrix result={r} />
            </>
          )}
          <Provenance env={q.data} />
        </QueryState>
      </Section>
    </div>
  );
}
