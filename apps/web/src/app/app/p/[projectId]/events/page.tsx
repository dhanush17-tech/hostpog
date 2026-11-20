"use client";
import type { EventRow, EventsCursor, EventsListQuery, EventsResult, PropertyFilter } from "@hostpog/contracts";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { EventInput, FilterEditor, QueryState, validFilters } from "@/components/analytics-controls";
import { useProject } from "@/components/project-context";
import { Provenance } from "@/components/provenance";
import { Button, Drawer, JsonView, PageHeader, Section, Table, Td, Th } from "@/components/ui";
import { useAnalytics } from "@/lib/api";
import { fmtTime } from "@/lib/format";

export default function Events() {
  const p = useProject();
  const [event, setEvent] = useState<string | null>(null);
  const [filters, setFilters] = useState<PropertyFilter[]>([]);
  const [cursors, setCursors] = useState<(EventsCursor | undefined)[]>([undefined]);
  const [rows, setRows] = useState<EventRow[]>([]);
  const [open, setOpen] = useState<EventRow | null>(null);
  const [live, setLive] = useState(false);
  const vf = useMemo(() => validFilters(filters), [filters]);
  const cursor = cursors[cursors.length - 1];
  const query: EventsListQuery | null = p.sourceId
    ? { kind: "events", event: event || undefined, filters: vf, dateRange: { from: p.range, to: "now" }, limit: 50, ...(cursor ? { cursor } : {}) }
    : null;
  const q = useAnalytics(p.projectId, p.sourceId, query, { refetchInterval: live && !cursor ? 5000 : false });

  // reset pagination when the query changes
  const resetKey = JSON.stringify([event, vf, p.range, p.sourceId]);
  useEffect(() => {
    setCursors([undefined]);
    setRows([]);
  }, [resetKey]);
  useEffect(() => {
    const r = q.data?.result as EventsResult | undefined;
    if (!r) return;
    setRows((prev) => (cursor ? [...prev.filter((x) => !r.rows.some((y) => y.uuid === x.uuid)), ...r.rows] : r.rows));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q.data]);
  const next = (q.data?.result as EventsResult | undefined)?.nextCursor;

  return (
    <div className="mx-auto max-w-[1280px]">
      <PageHeader
        title="Events"
        description="Every event as it arrives."
        actions={
          <label className="flex items-center gap-2 text-[13px] text-ink-2">
            <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} /> Live (refresh every 5 s)
          </label>
        }
      />
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <EventInput label="Filter by event" value={event} onChange={setEvent} allowAll />
        <FilterEditor filters={filters} onChange={setFilters} />
      </div>
      <Section>
        <QueryState q={{ ...q, isLoading: q.isLoading && !rows.length }} empty={!rows.length && !q.isFetching}>
          <Table>
            <thead>
              <tr>
                <Th>Time ({p.source?.kind === "posthog" ? String(p.source.config.timezone ?? p.timezone) : p.timezone})</Th>
                <Th>Event</Th>
                <Th>Person</Th>
                <Th className="hidden md:table-cell">Path / URL</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.uuid} className="cursor-pointer hover:bg-panel-2" onClick={() => setOpen(r)} tabIndex={0} onKeyDown={(e) => e.key === "Enter" && setOpen(r)}>
                  <Td className="tnum whitespace-nowrap text-ink-2">{fmtTime(r.timestamp, String(p.source?.config.timezone ?? p.timezone))}</Td>
                  <Td className="font-mono text-[12px]">{r.event}</Td>
                  <Td className="max-w-[220px] truncate">
                    {r.personId ? (
                      <Link className="hover:underline" href={p.href(`users/${encodeURIComponent(r.personId)}`)} onClick={(e) => e.stopPropagation()}>
                        {r.distinctId}
                      </Link>
                    ) : (
                      r.distinctId
                    )}
                  </Td>
                  <Td className="hidden max-w-[360px] truncate text-ink-2 md:table-cell">{String(r.properties.$pathname ?? r.properties.$current_url ?? "")}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="flex items-center justify-between gap-2 px-4 py-2">
            <span className="text-[12px] text-ink-3">{rows.length} events loaded</span>
            {next && (
              <Button size="sm" loading={q.isFetching} onClick={() => setCursors([...cursors, next])}>
                Load more
              </Button>
            )}
          </div>
          <Provenance env={q.data} />
        </QueryState>
      </Section>
      <Drawer open={Boolean(open)} onClose={() => setOpen(null)} title={open?.event ?? "Event"}>
        {open && (
          <div className="space-y-3 text-[13px]">
            <dl className="grid grid-cols-[110px_1fr] gap-y-1">
              <dt className="text-ink-3">UUID</dt>
              <dd className="font-mono text-[12px]">{open.uuid}</dd>
              <dt className="text-ink-3">Timestamp</dt>
              <dd>{open.timestamp}</dd>
              <dt className="text-ink-3">Distinct ID</dt>
              <dd className="break-all">{open.distinctId}</dd>
              <dt className="text-ink-3">Person</dt>
              <dd className="break-all">{open.personId ?? "—"}</dd>
              <dt className="text-ink-3">Session</dt>
              <dd className="break-all">{open.sessionId ?? "—"}</dd>
            </dl>
            <JsonView value={open.properties} />
          </div>
        )}
      </Drawer>
    </div>
  );
}
