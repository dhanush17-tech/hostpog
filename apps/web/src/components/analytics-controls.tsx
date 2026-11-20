"use client";
import type { AnalyticsQuery, EventDefinition, Envelope, PropertyFilter } from "@hostpog/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Save, X } from "lucide-react";
import Link from "next/link";
import { useId, useState, type ReactNode } from "react";
import { apiGet, apiSend, type ApiError } from "@/lib/api";
import { useProject } from "./project-context";
import { Button, Empty, ErrorBox, Input, Select, Skeleton } from "./ui";

export function useEventDefinitions() {
  const p = useProject();
  return useQuery({
    queryKey: ["defs", p.projectId, p.sourceId],
    queryFn: () => apiGet<Envelope<EventDefinition[]>>(`/api/v1/projects/${p.projectId}/event-definitions?sourceId=${p.sourceId}`),
    enabled: Boolean(p.sourceId),
    staleTime: 5 * 60_000,
  });
}

/** Event name input with autocomplete from the source's event definitions. */
export function EventInput({ value, onChange, allowAll, label, className }: { value: string | null; onChange: (v: string | null) => void; allowAll?: boolean; label: string; className?: string }) {
  const defs = useEventDefinitions();
  const list = useId();
  return (
    <>
      <Input
        aria-label={label}
        list={list}
        className={className ?? "w-[220px]"}
        placeholder={allowAll ? "All events" : "Event name"}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" && allowAll ? null : e.target.value)}
      />
      <datalist id={list}>
        {(defs.data?.result ?? []).map((d) => (
          <option key={d.name} value={d.name} />
        ))}
      </datalist>
    </>
  );
}

const OPS: { value: PropertyFilter["operator"]; label: string }[] = [
  { value: "eq", label: "equals" },
  { value: "neq", label: "is not" },
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "does not contain" },
  { value: "is_set", label: "is set" },
  { value: "is_not_set", label: "is not set" },
  { value: "gt", label: ">" },
  { value: "lt", label: "<" },
];

export function FilterEditor({ filters, onChange }: { filters: PropertyFilter[]; onChange: (f: PropertyFilter[]) => void }) {
  const set = (i: number, patch: Partial<PropertyFilter>) => onChange(filters.map((f, j) => (j === i ? ({ ...f, ...patch } as PropertyFilter) : f)));
  return (
    <div className="flex flex-wrap items-center gap-2">
      {filters.map((f, i) => (
        <div key={i} className="flex items-center gap-1 rounded-md border border-line bg-panel-2 p-1">
          <Select aria-label="Property type" value={f.type} onChange={(e) => set(i, { type: e.target.value as "event" | "person" })} className="h-6 text-[12px]">
            <option value="event">event</option>
            <option value="person">person</option>
          </Select>
          <Input aria-label="Property key" className="h-6 w-[130px] text-[12px]" placeholder="$browser" value={f.key} onChange={(e) => set(i, { key: e.target.value })} />
          <Select aria-label="Operator" value={f.operator} onChange={(e) => set(i, { operator: e.target.value as PropertyFilter["operator"] })} className="h-6 text-[12px]">
            {OPS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          {f.operator !== "is_set" && f.operator !== "is_not_set" && (
            <Input aria-label="Value" className="h-6 w-[110px] text-[12px]" value={String(f.value ?? "")} onChange={(e) => set(i, { value: f.operator === "gt" || f.operator === "lt" ? Number(e.target.value) : e.target.value })} />
          )}
          <button aria-label="Remove filter" className="px-1 text-ink-3 hover:text-ink" onClick={() => onChange(filters.filter((_, j) => j !== i))}>
            <X size={14} />
          </button>
        </div>
      ))}
      <Button size="sm" variant="ghost" onClick={() => onChange([...filters, { type: "event", key: "", operator: "eq", value: "" }])}>
        <Plus size={14} /> Filter
      </Button>
    </div>
  );
}

/** Drop incomplete filters before querying. */
export function validFilters(fs: PropertyFilter[]): PropertyFilter[] {
  return fs.filter((f) => f.key.trim() && (f.operator === "is_set" || f.operator === "is_not_set" || (f.value !== "" && f.value !== undefined && !Number.isNaN(f.value))));
}

/** Uniform loading / error / no-source handling for query-backed panels. */
export function QueryState({ q, empty, children, height = 200 }: { q: { isLoading: boolean; error: ApiError | null; data?: unknown }; empty?: boolean; children: ReactNode; height?: number }) {
  const p = useProject();
  if (!p.sourcesLoading && !p.source)
    return (
      <div className="p-4">
        <Empty title="No data source yet" action={<Link className="text-[13px] text-brand-deep hover:underline" href={`/app/onboarding?project=${p.projectId}`}>Connect PostHog or install the SDK →</Link>} />
      </div>
    );
  if (q.isLoading || p.sourcesLoading)
    return (
      <div className="space-y-2 p-4">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="w-full" />
        <div style={{ height: height - 40 }} className="skeleton" />
      </div>
    );
  if (q.error) {
    const action =
      q.error.code === "provider_unauthorized" ? (
        <Link className="text-[12px] text-brand-deep hover:underline" href={p.href("settings/integrations")}>
          Reconnect in Integrations →
        </Link>
      ) : q.error.code === "provider_forbidden" ? (
        <span className="text-[12px] text-ink-3">The credential lacks a required read scope. Add it in PostHog, then rotate the key in Integrations.</span>
      ) : q.error.status === 429 ? (
        <span className="text-[12px] text-ink-3">PostHog rate limits protect your account. Results will be available again shortly.</span>
      ) : undefined;
    return (
      <div className="p-4">
        <ErrorBox error={q.error} action={action} />
      </div>
    );
  }
  if (empty)
    return (
      <div className="p-4">
        <Empty title="No data in this range">Try a longer date range or check that events are arriving.</Empty>
      </div>
    );
  return <>{children}</>;
}

export function SaveInsight({ query, defaultName }: { query: AnalyticsQuery; defaultName: string }) {
  const p = useProject();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(defaultName);
  const [dash, setDash] = useState("");
  const [state, setState] = useState<"idle" | "saving" | "saved" | string>("idle");
  const dashboards = useQuery({
    queryKey: ["dashboards", p.projectId],
    queryFn: () => apiGet<{ dashboards: { id: string; name: string }[] }>(`/api/v1/projects/${p.projectId}/dashboards`),
    enabled: open,
  });
  if (!p.can("member")) return null;
  if (!open)
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        <Save size={14} /> Save
      </Button>
    );
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-line bg-panel p-1.5">
      <Input aria-label="Insight name" className="h-7 w-[200px]" value={name} onChange={(e) => setName(e.target.value)} />
      <Select aria-label="Add to dashboard" value={dash} onChange={(e) => setDash(e.target.value)} className="h-7">
        <option value="">No dashboard</option>
        {(dashboards.data?.dashboards ?? []).map((d) => (
          <option key={d.id} value={d.id}>
            {d.name}
          </option>
        ))}
      </Select>
      <Button
        size="sm"
        variant="primary"
        loading={state === "saving"}
        onClick={async () => {
          setState("saving");
          try {
            const r = await apiSend<{ insight: { id: string } }>(`/api/v1/projects/${p.projectId}/insights`, "POST", { name, query, sourceId: p.sourceId });
            if (dash) await apiSend(`/api/v1/projects/${p.projectId}/dashboards/${dash}`, "PATCH", { addInsightId: r.insight.id });
            await qc.invalidateQueries({ queryKey: ["dashboard"] });
            setState("saved");
            setTimeout(() => {
              setOpen(false);
              setState("idle");
            }, 1200);
          } catch (e) {
            setState((e as Error).message);
          }
        }}
      >
        {state === "saved" ? "Saved" : "Save insight"}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setOpen(false)} aria-label="Cancel">
        <X size={14} />
      </Button>
      {state !== "idle" && state !== "saving" && state !== "saved" && <span className="text-[12px] text-neg">{state}</span>}
    </div>
  );
}
