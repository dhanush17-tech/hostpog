"use client";
import type { CapabilityReport, Envelope } from "@hostpog/contracts";
import type { SessionSummary } from "@hostpog/analytics";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink } from "lucide-react";
import { QueryState } from "@/components/analytics-controls";
import { useProject } from "@/components/project-context";
import { Provenance } from "@/components/provenance";
import { PageHeader, Section, Table, Td, Th } from "@/components/ui";
import { apiGet, type ApiError } from "@/lib/api";
import { fmtDuration, fmtTime } from "@/lib/format";

export default function Sessions() {
  const p = useProject();
  const q = useQuery<{ sessions: Envelope<SessionSummary[]>; capabilities: CapabilityReport }, ApiError>({
    queryKey: ["sessions", p.projectId, p.sourceId],
    queryFn: () => apiGet(`/api/v1/projects/${p.projectId}/sessions?sourceId=${p.sourceId}`),
    enabled: Boolean(p.sourceId),
  });
  const playback = q.data?.capabilities.unavailable.find((u) => u.capability === "replay_playback");
  const rows = q.data?.sessions.result ?? [];
  return (
    <div className="mx-auto max-w-[1280px]">
      <PageHeader title="Sessions" description="Recent sessions and what happened in them." />
      {playback && <p className="mb-3 rounded-md border border-line bg-panel px-3 py-2 text-[13px] text-ink-2">Replay playback is not available in HostPog for this source: {playback.reason}</p>}
      <Section>
        <QueryState q={q} empty={!rows.length}>
          <Table>
            <thead>
              <tr>
                <Th>Started</Th>
                <Th>Duration</Th>
                <Th>Distinct ID</Th>
                <Th>Recording</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.sessionId}>
                  <Td className="whitespace-nowrap">{fmtTime(s.startTime, String(p.source?.config.timezone ?? p.timezone))}</Td>
                  <Td className="tnum">{fmtDuration(s.durationSeconds)}</Td>
                  <Td className="max-w-[260px] truncate font-mono text-[12px]">{s.distinctId}</Td>
                  <Td>
                    {s.externalUrl ? (
                      <a href={s.externalUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-[12px] text-brand-deep hover:underline" title="Opens in PostHog if a recording exists; PostHog checks your access">
                        Open in PostHog <ExternalLink size={12} />
                      </a>
                    ) : (
                      <span className="text-[12px] text-ink-3">—</span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
          <Provenance env={q.data?.sessions} />
        </QueryState>
      </Section>
    </div>
  );
}
