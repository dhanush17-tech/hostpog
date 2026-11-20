"use client";
import type { Envelope, EventsResult, PersonRow } from "@hostpog/contracts";
import type { SessionSummary } from "@hostpog/analytics";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useProject } from "@/components/project-context";
import { Provenance } from "@/components/provenance";
import { Badge, Drawer, ErrorBox, JsonView, PageHeader, Section, Skeleton } from "@/components/ui";
import { apiGet, type ApiError } from "@/lib/api";
import { fmtDuration, fmtTime, personLabel } from "@/lib/format";

interface Resp {
  person: Envelope<PersonRow>;
  events: Envelope<EventsResult>;
  sessions: Envelope<SessionSummary[]> | null;
}

export default function Person() {
  const p = useProject();
  const { personId } = useParams<{ personId: string }>();
  const [open, setOpen] = useState<EventsResult["rows"][number] | null>(null);
  const q = useQuery<Resp, ApiError>({
    queryKey: ["person", p.projectId, p.sourceId, personId],
    queryFn: () => apiGet(`/api/v1/projects/${p.projectId}/persons/${personId}?sourceId=${p.sourceId}`),
    enabled: Boolean(p.sourceId),
  });
  if (q.error) return <ErrorBox error={q.error} />;
  if (!q.data) return <Skeleton className="h-40 w-full" />;
  const person = q.data.person.result;
  const tz = String(p.source?.config.timezone ?? p.timezone);
  let lastDay = "";
  return (
    <div className="mx-auto max-w-[1280px]">
      <Link href={p.href("users")} className="text-[13px] text-ink-3 hover:text-ink">
        ← Users
      </Link>
      <PageHeader title={personLabel(person)} description={<span className="inline-flex items-center gap-2">{person.isIdentified ? <Badge tone="brand">identified</Badge> : <Badge>anonymous</Badge>} first seen {fmtTime(person.createdAt, tz)}</span>} />
      <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <Section title="Activity (last 90 days, newest first)">
          <ol className="px-4 py-2">
            {q.data.events.result.rows.map((e) => {
              const day = e.timestamp.slice(0, 10);
              const header = day !== lastDay ? day : null;
              lastDay = day;
              return (
                <li key={e.uuid}>
                  {header && <p className="mb-1 mt-3 text-[11px] font-medium uppercase tracking-wide text-ink-3">{header}</p>}
                  <button className="flex w-full items-baseline gap-3 rounded px-1 py-1 text-left hover:bg-panel-2" onClick={() => setOpen(e)}>
                    <span className="tnum w-14 shrink-0 text-[12px] text-ink-3">{new Intl.DateTimeFormat("en-US", { timeStyle: "short", timeZone: tz }).format(new Date(e.timestamp))}</span>
                    <span className="font-mono text-[12px]">{e.event}</span>
                    <span className="truncate text-[12px] text-ink-3">{String(e.properties.$pathname ?? "")}</span>
                  </button>
                </li>
              );
            })}
            {!q.data.events.result.rows.length && <li className="py-3 text-[13px] text-ink-3">No events in the last 90 days.</li>}
          </ol>
          <Provenance env={q.data.events} />
        </Section>
        <div className="space-y-5">
          <Section title="Properties">
            <div className="p-3">
              <JsonView value={person.properties} />
            </div>
            <div className="border-t border-line px-4 py-2 text-[12px] text-ink-3">Distinct IDs: <span className="break-all font-mono">{person.distinctIds.join(", ")}</span></div>
            <Provenance env={q.data.person} />
          </Section>
          <Section title="Sessions">
            <ul className="divide-y divide-line">
              {(q.data.sessions?.result ?? []).map((s) => (
                <li key={s.sessionId} className="flex items-center justify-between gap-2 px-4 py-2 text-[12px]">
                  <span>
                    {fmtTime(s.startTime, tz)} · {fmtDuration(s.durationSeconds)}
                  </span>
                  {s.externalUrl && (
                    <a href={s.externalUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-brand-deep hover:underline">
                      Recording <ExternalLink size={12} />
                    </a>
                  )}
                </li>
              ))}
              {!q.data.sessions?.result.length && <li className="px-4 py-2 text-[12px] text-ink-3">No sessions with $session_id.</li>}
            </ul>
          </Section>
        </div>
      </div>
      <Drawer open={Boolean(open)} onClose={() => setOpen(null)} title={open?.event ?? ""}>
        {open && <JsonView value={{ uuid: open.uuid, timestamp: open.timestamp, distinctId: open.distinctId, sessionId: open.sessionId, properties: open.properties }} />}
      </Drawer>
    </div>
  );
}
