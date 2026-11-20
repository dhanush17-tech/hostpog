"use client";
import type { EventsResult, TopValuesResult, TrendQuery, TrendResult } from "@hostpog/contracts";
import { useState } from "react";
import { QueryState } from "@/components/analytics-controls";
import { TrendView } from "@/components/insight-views";
import { SetupCode, Stat } from "@/components/products/shared";
import { useProject } from "@/components/project-context";
import { Provenance } from "@/components/provenance";
import { Badge, Drawer, Empty, JsonView, PageHeader, Section, Table, Td, Th } from "@/components/ui";
import { useAnalytics } from "@/lib/api";
import { fmtInt, fmtNum, fmtPct, fmtRelative } from "@/lib/format";

const GEN = "$ai_generation";
const usd = (n: number | null | undefined) => (n === null || n === undefined ? "—" : n < 1 ? `$${n.toFixed(4)}` : `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`);
const sumOf = (r?: TrendResult, i = 0) => r?.series[i]?.total ?? 0;

export default function LlmAnalytics() {
  const p = useProject();
  const [open, setOpen] = useState<EventsResult["rows"][number] | null>(null);
  const dateRange = { from: p.range, to: "now" };
  const trend = (series: TrendQuery["series"], breakdown?: TrendQuery["breakdown"]): TrendQuery | null =>
    p.sourceId ? { kind: "trend", series, interval: "day", dateRange, compare: false, filters: [], ...(breakdown ? { breakdown } : {}) } : null;

  const totals = useAnalytics(
    p.projectId,
    p.sourceId,
    trend([
      { event: GEN, math: "total", filters: [], label: "Generations" },
      { event: GEN, math: "sum", property: "$ai_total_cost_usd", filters: [], label: "Cost" },
      { event: GEN, math: "sum", property: "$ai_input_tokens", filters: [], label: "Input tokens" },
      { event: GEN, math: "sum", property: "$ai_output_tokens", filters: [], label: "Output tokens" },
      { event: GEN, math: "p95", property: "$ai_latency", filters: [], label: "p95 latency" },
      { event: GEN, math: "total", filters: [{ type: "event", key: "$ai_is_error", operator: "eq", value: "true" }], label: "Errors" },
    ]),
  );
  const users = useAnalytics(p.projectId, p.sourceId, trend([{ event: GEN, math: "unique_users", filters: [] }]));
  const byModel = useAnalytics(p.projectId, p.sourceId, trend([{ event: GEN, math: "sum", property: "$ai_total_cost_usd", filters: [], label: "Cost" }], { type: "event", key: "$ai_model", limit: 6 }));
  const models = useAnalytics(
    p.projectId,
    p.sourceId,
    p.sourceId ? { kind: "top", event: GEN, groupBy: { type: "event", key: "$ai_model", limit: 10 }, dateRange, filters: [], limit: 10 } : null,
  );
  const recent = useAnalytics(p.projectId, p.sourceId, p.sourceId ? { kind: "events", event: GEN, filters: [], dateRange, limit: 50 } : null);

  const t = totals.data?.result as TrendResult | undefined;
  const generations = sumOf(t, 0);
  const latencySeries = t?.series[4];
  const p95 = latencySeries?.points.length ? Math.max(...latencySeries.points.map((x) => x.v)) : null;
  const m = byModel.data?.result as TrendResult | undefined;
  const rows = (recent.data?.result as EventsResult | undefined)?.rows ?? [];
  const top = (models.data?.result as TopValuesResult | undefined)?.rows ?? [];
  const empty = totals.isSuccess && generations === 0;

  return (
    <div className="mx-auto max-w-[1280px] space-y-5">
      <PageHeader title="LLM analytics" description="Cost, tokens, latency and errors of the AI features in your product, by model and by user." />
      {!empty && <QueryState q={totals} height={120}>
        <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Generations" value={fmtInt(generations)} />
          <Stat label="Cost" value={usd(sumOf(t, 1))} hint={generations ? `${usd(sumOf(t, 1) / generations)} per call` : undefined} />
          <Stat label="Tokens" value={fmtNum(sumOf(t, 2) + sumOf(t, 3), 0)} hint={`${fmtNum(sumOf(t, 2), 0)} in · ${fmtNum(sumOf(t, 3), 0)} out`} />
          <Stat label="Slowest day p95" value={p95 === null ? "—" : `${fmtNum(p95, 2)}s`} />
          <Stat label="Errors" value={fmtInt(sumOf(t, 5))} hint={generations ? fmtPct(sumOf(t, 5) / generations) : undefined} tone={sumOf(t, 5) ? "neg" : undefined} />
          <Stat label="Peak daily users" value={fmtInt(sumOf(users.data?.result as TrendResult | undefined))} />
        </div>
      </QueryState>}
      {empty ? (
        <>
          <Section>
            <div className="p-4">
              <Empty title={`No ${GEN} events in this range`}>
                Send one event per LLM call. PostHog&apos;s <code>@posthog/ai</code> wrappers (OpenAI, Anthropic, Gemini, LangChain, Vercel AI SDK) do it automatically when pointed at HostPog.
              </Empty>
            </div>
          </Section>
          <SetupCode
            title="Track your LLM calls"
            sdks={["node", "python", "hostpog"]}
            code={(sdk, { key, host }) =>
              sdk === "node"
                ? `// npm i @posthog/ai posthog-node openai\nimport { OpenAI } from "@posthog/ai";\nimport { PostHog } from "posthog-node";\n\nconst phClient = new PostHog("${key}", { host: "${host}/ph" });\nconst openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY, posthog: phClient });\n\nawait openai.responses.create({\n  model: "gpt-5-mini",\n  input: "Hello",\n  posthogDistinctId: userId, // who made the call\n});`
                : sdk === "python"
                  ? `# pip install posthog openai\nfrom posthog import Posthog\nfrom posthog.ai.openai import OpenAI\n\nposthog = Posthog("${key}", host="${host}/ph")\nclient = OpenAI(api_key=os.environ["OPENAI_API_KEY"], posthog_client=posthog)\n\nclient.responses.create(model="gpt-5-mini", input="Hello", posthog_distinct_id=user_id)`
                  : `// any SDK: send one event per call\nhostpog.capture("$ai_generation", {\n  $ai_model: "gpt-5-mini",\n  $ai_provider: "openai",\n  $ai_input_tokens: 812,\n  $ai_output_tokens: 164,\n  $ai_latency: 1.42,          // seconds\n  $ai_total_cost_usd: 0.0021,\n  $ai_trace_id: traceId,      // optional: group calls of one request\n});`
            }
          />
        </>
      ) : (
        <>
          <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
            <Section title="Cost per day, by model">
              <div className="p-4">
                <QueryState q={byModel} height={260}>
                  {m && <TrendView result={m} kind="bar" height={260} />}
                </QueryState>
              </div>
            </Section>
            <Section title="Models">
              <Table>
                <thead>
                  <tr>
                    <Th>Model</Th>
                    <Th className="text-right">Calls</Th>
                    <Th className="text-right">Users</Th>
                  </tr>
                </thead>
                <tbody>
                  {top.map((r) => (
                    <tr key={r.value ?? "none"}>
                      <Td className="font-mono text-[12px]">{r.value ?? "unknown"}</Td>
                      <Td className="text-right tabular-nums">{fmtInt(r.count)}</Td>
                      <Td className="text-right tabular-nums">{fmtInt(r.uniqueUsers)}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </Section>
          </div>
          <Section title="Recent generations">
            <Table>
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Model</Th>
                  <Th>User</Th>
                  <Th className="text-right">Tokens in / out</Th>
                  <Th className="text-right">Latency</Th>
                  <Th className="text-right">Cost</Th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const pr = r.properties;
                  const err = String(pr.$ai_is_error ?? "") === "true";
                  return (
                    <tr key={r.uuid} className="cursor-pointer hover:bg-panel-2" onClick={() => setOpen(r)}>
                      <Td className="text-[12px] text-ink-3">{fmtRelative(r.timestamp)}</Td>
                      <Td className="font-mono text-[12px]">
                        {String(pr.$ai_model ?? "—")} {err && <Badge tone="neg">error</Badge>}
                      </Td>
                      <Td className="max-w-[180px] truncate text-[12px]">{r.distinctId}</Td>
                      <Td className="text-right tabular-nums text-[12px]">
                        {fmtInt(Number(pr.$ai_input_tokens ?? 0))} / {fmtInt(Number(pr.$ai_output_tokens ?? 0))}
                      </Td>
                      <Td className="text-right tabular-nums text-[12px]">{pr.$ai_latency !== undefined ? `${fmtNum(Number(pr.$ai_latency), 2)}s` : "—"}</Td>
                      <Td className="text-right tabular-nums text-[12px]">{pr.$ai_total_cost_usd !== undefined ? usd(Number(pr.$ai_total_cost_usd)) : "—"}</Td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </Section>
          {totals.data && <Provenance env={totals.data} />}
        </>
      )}
      <Drawer open={Boolean(open)} onClose={() => setOpen(null)} title={open ? String(open.properties.$ai_model ?? "Generation") : ""}>
        {open && (
          <div className="space-y-4 text-[13px]">
            <p className="text-ink-3">
              {open.distinctId} · {fmtRelative(open.timestamp)}
              {open.properties.$ai_trace_id ? ` · trace ${String(open.properties.$ai_trace_id)}` : ""}
            </p>
            {open.properties.$ai_input !== undefined && (
              <div>
                <p className="mb-1 font-medium">Input</p>
                <JsonView value={open.properties.$ai_input} />
              </div>
            )}
            {open.properties.$ai_output_choices !== undefined && (
              <div>
                <p className="mb-1 font-medium">Output</p>
                <JsonView value={open.properties.$ai_output_choices} />
              </div>
            )}
            <div>
              <p className="mb-1 font-medium">All properties</p>
              <JsonView value={Object.fromEntries(Object.entries(open.properties).filter(([k]) => k !== "$ai_input" && k !== "$ai_output_choices"))} />
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
