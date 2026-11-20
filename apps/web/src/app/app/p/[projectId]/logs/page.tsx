"use client";
import { useInfiniteQuery } from "@tanstack/react-query";
import { Search } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { SetupCode } from "@/components/products/shared";
import { useProject } from "@/components/project-context";
import { Badge, Button, cx, Drawer, Empty, ErrorBox, Input, JsonView, PageHeader, Section, Segmented, Select, Skeleton } from "@/components/ui";
import { apiGet } from "@/lib/api";
import { fmtInt } from "@/lib/format";

const LEVELS = ["error", "warn", "info", "debug"] as const;
type Level = (typeof LEVELS)[number] | "trace" | "fatal";
const RANGES = [
  { value: "1h", label: "1h" },
  { value: "24h", label: "24h" },
  { value: "7d", label: "7d" },
  { value: "30d", label: "30d" },
] as const;
type Range = (typeof RANGES)[number]["value"];

interface LogRow {
  timestamp: string;
  level: Level;
  service: string;
  message: string;
  attributes: Record<string, string>;
  trace_id: string;
  distinct_id: string;
}
interface LogsPage {
  range: Range;
  rows: LogRow[];
  overview: { histogram: { t: string; level: string; n: number }[]; services: { service: string; n: number }[] } | null;
  nextBefore: string | null;
}

const LEVEL_COLOR: Record<string, string> = { fatal: "var(--neg)", error: "var(--neg)", warn: "var(--warn)", info: "var(--chart-2)", debug: "var(--ink-3)", trace: "var(--ink-3)" };
const tone = (l: string) => (l === "error" || l === "fatal" ? "neg" : l === "warn" ? "warn" : "neutral");

function useDebounced<T>(v: T, ms = 300) {
  const [d, setD] = useState(v);
  useEffect(() => {
    const t = setTimeout(() => setD(v), ms);
    return () => clearTimeout(t);
  }, [v, ms]);
  return d;
}

export default function Logs() {
  const p = useProject();
  const [range, setRange] = useState<Range>("24h");
  const [levels, setLevels] = useState<string[]>([]);
  const [service, setService] = useState("");
  const [text, setText] = useState("");
  const [open, setOpen] = useState<LogRow | null>(null);
  const q = useDebounced(text.trim());

  const params = useMemo(() => {
    const s = new URLSearchParams({ range });
    if (levels.length) s.set("levels", levels.join(","));
    if (service) s.set("service", service);
    if (q) s.set("q", q);
    return s;
  }, [range, levels, service, q]);

  const logs = useInfiniteQuery({
    queryKey: ["logs", p.projectId, params.toString()],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const s = new URLSearchParams(params);
      if (pageParam) s.set("before", pageParam);
      return apiGet<LogsPage>(`/api/v1/projects/${p.projectId}/logs?${s}`, signal);
    },
    getNextPageParam: (last) => last.nextBefore,
    refetchInterval: range === "1h" ? 15_000 : false,
  });

  const first = logs.data?.pages[0];
  const rows = logs.data?.pages.flatMap((x) => x.rows) ?? [];
  const overview = first?.overview;
  const total = overview?.histogram.reduce((s, h) => s + h.n, 0) ?? 0;
  const errors = overview?.histogram.filter((h) => h.level === "error" || h.level === "fatal").reduce((s, h) => s + h.n, 0) ?? 0;
  const nothingAtAll = logs.isSuccess && total === 0 && !levels.length && !service && !q;
  const toggle = (l: string) => setLevels((ls) => (ls.includes(l) ? ls.filter((x) => x !== l) : [...ls, l]));

  return (
    <div className="mx-auto max-w-[1280px] space-y-5">
      <PageHeader
        title="Logs"
        description="Application logs next to your product data. Search them, and jump from a log line to the user who hit it."
        actions={<Segmented label="Time range" value={range} onChange={setRange} options={[...RANGES]} />}
      />

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[260px] flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
          <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Search messages" className="pl-8" aria-label="Search log messages" />
        </div>
        <div className="flex items-center gap-1" role="group" aria-label="Levels">
          {LEVELS.map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={levels.includes(l)}
              onClick={() => toggle(l)}
              className={cx(
                "flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-[12px] font-medium capitalize transition-colors",
                levels.includes(l) ? "border-line-strong bg-panel-2 text-ink" : "border-line text-ink-2 hover:bg-panel-2",
              )}
            >
              <span className="size-2 rounded-full" style={{ background: LEVEL_COLOR[l] }} />
              {l}
            </button>
          ))}
        </div>
        <Select value={service} onChange={(e) => setService(e.target.value)} aria-label="Service" className="w-44">
          <option value="">All services</option>
          {overview?.services.filter((s) => s.service).map((s) => (
            <option key={s.service} value={s.service}>
              {s.service} ({fmtInt(s.n)})
            </option>
          ))}
        </Select>
      </div>

      {logs.isError ? (
        <ErrorBox error={logs.error} action={<Button size="sm" onClick={() => logs.refetch()}>Try again</Button>} />
      ) : nothingAtAll ? (
        <>
          <Section>
            <div className="p-4">
              <Empty title="No logs yet">Send logs over OpenTelemetry (OTLP/HTTP JSON) or with a plain JSON POST. They are kept for 30 days.</Empty>
            </div>
          </Section>
          <LogsSetup />
        </>
      ) : (
        <>
          <Section title={first ? `${fmtInt(total)} logs${errors ? ` · ${fmtInt(errors)} errors` : ""}` : "Logs"}>
            <div className="px-4 pb-4 pt-1">{overview ? <Histogram data={overview.histogram} /> : <Skeleton className="h-24 w-full" />}</div>
          </Section>
          <Section>
            {logs.isPending ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 8 }, (_, i) => (
                  <Skeleton key={i} className="h-6 w-full" />
                ))}
              </div>
            ) : rows.length === 0 ? (
              <div className="p-4">
                <Empty title="No logs match">Try a wider time range or clear a filter.</Empty>
              </div>
            ) : (
              <div className="divide-y divide-line font-mono text-[12px]">
                {rows.map((r, i) => (
                  <button key={`${r.timestamp}-${i}`} type="button" onClick={() => setOpen(r)} className="flex w-full items-start gap-3 px-4 py-1.5 text-left hover:bg-panel-2">
                    <span className="shrink-0 tabular-nums text-ink-3">{new Date(r.timestamp).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                    <span className="w-12 shrink-0 font-semibold uppercase" style={{ color: LEVEL_COLOR[r.level] }}>
                      {r.level}
                    </span>
                    <span className="w-20 shrink-0 truncate text-ink-2">{r.service || "—"}</span>
                    <span className="min-w-0 flex-1 truncate text-ink">{r.message}</span>
                  </button>
                ))}
              </div>
            )}
            {logs.hasNextPage && (
              <div className="border-t border-line p-3 text-center">
                <Button size="sm" variant="secondary" loading={logs.isFetchingNextPage} onClick={() => logs.fetchNextPage()}>
                  Load older
                </Button>
              </div>
            )}
          </Section>
          <LogsSetup />
        </>
      )}

      <Drawer open={!!open} onClose={() => setOpen(null)} title="Log line">
        {open && (
          <div className="space-y-4 text-[13px]">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={tone(open.level)}>{open.level}</Badge>
              {open.service && <Badge>{open.service}</Badge>}
              <span className="text-ink-3">{new Date(open.timestamp).toLocaleString()}</span>
            </div>
            <pre className="whitespace-pre-wrap break-words rounded-lg bg-panel-2 p-3 font-mono text-[12px]">{open.message}</pre>
            <div className="flex flex-wrap gap-2">
              {open.distinct_id && (
                <a href={p.href(`users/${encodeURIComponent(open.distinct_id)}`)}>
                  <Button size="sm" variant="secondary">View user {open.distinct_id}</Button>
                </a>
              )}
            </div>
            {open.trace_id && <p className="text-ink-3">Trace {open.trace_id}</p>}
            <JsonView value={open.attributes} />
          </div>
        )}
      </Drawer>
    </div>
  );
}

function Histogram({ data }: { data: { t: string; level: string; n: number }[] }) {
  const buckets = useMemo(() => {
    const m = new Map<string, Record<string, number>>();
    for (const h of data) {
      const b = m.get(h.t) ?? {};
      b[h.level] = (b[h.level] ?? 0) + h.n;
      m.set(h.t, b);
    }
    return [...m.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [data]);
  if (!buckets.length) return <div className="flex h-24 items-center justify-center text-[12px] text-ink-3">Nothing in this range</div>;
  const max = Math.max(...buckets.map(([, b]) => Object.values(b).reduce((s, n) => s + n, 0)));
  const order = ["fatal", "error", "warn", "info", "debug", "trace"];
  return (
    <div className="flex h-24 items-end gap-px" role="img" aria-label="Log volume over time by level">
      {buckets.map(([t, b]) => {
        const sum = Object.values(b).reduce((s, n) => s + n, 0);
        return (
          <div key={t} className="flex h-full min-w-[2px] flex-1 flex-col-reverse" title={`${new Date(t).toLocaleString()} · ${sum} logs`}>
            {order
              .filter((l) => b[l])
              .reverse()
              .map((l) => (
                <div key={l} style={{ height: `${(b[l]! / max) * 100}%`, background: LEVEL_COLOR[l] }} className="w-full opacity-80 first:rounded-b-none last:rounded-t-[2px]" />
              ))}
          </div>
        );
      })}
    </div>
  );
}

function LogsSetup() {
  return (
    <SetupCode
      title="Send logs"
      sdks={["node", "python", "hostpog"]}
      labels={{ node: "OpenTelemetry", python: "Python", hostpog: "curl" }}
      code={(sdk, { key, host }) =>
        sdk === "node"
          ? `// OpenTelemetry (any language with an OTLP/HTTP exporter works the same way)
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http";

const exporter = new OTLPLogExporter({
  url: "${host}/v1/logs",
  headers: { Authorization: "Bearer ${key}" },
});`
          : sdk === "python"
            ? `import requests

requests.post("${host}/v1/logs", headers={"Authorization": "Bearer ${key}"}, json={
    "logs": [{
        "level": "error",
        "service": "billing",
        "message": "Stripe webhook failed",
        "distinct_id": user_id,  # links the line to the user in HostPog
        "attributes": {"route": "/api/billing/webhook"},
    }]
})`
            : `curl ${host}/v1/logs \\
  -H "Authorization: Bearer ${key}" \\
  -H "Content-Type: application/json" \\
  -d '{"logs":[{"level":"info","service":"api","message":"Deployed v1.4.2"}]}'`
      }
      note={<>Add <code>distinct_id</code> (or the OTLP attribute <code>posthog.distinct_id</code>) to tie a log line to a user.</>}
    />
  );
}
