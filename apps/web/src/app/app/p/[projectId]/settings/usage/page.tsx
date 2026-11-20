"use client";
import { useQuery } from "@tanstack/react-query";
import { useProject } from "@/components/project-context";
import { PageHeader, Section, Table, Td, Th } from "@/components/ui";
import { apiGet } from "@/lib/api";
import { fmtInt, fmtTime } from "@/lib/format";

interface Usage {
  ai: { total: { inputTokens: number; outputTokens: number; requests: number; since: string }; providers: { id: string; label: string; budget: number; usage: { inputTokens: number; outputTokens: number } }[] };
  sources: { id: string; label: string; kind: string; status: string; stats: { ok: number; errors: number; rateLimited: number }; posthogBudget: Record<string, { lastMinute: number; lastHour: number; limitPerHour: number }> | null; storage: { events: number; bytes: number } | null }[];
  note: string;
}

export default function UsagePage() {
  const p = useProject();
  const u = useQuery({ queryKey: ["usage", p.workspaceId], queryFn: () => apiGet<Usage>(`/api/v1/workspaces/${p.workspaceId}/usage`) });
  const audit = useQuery({
    queryKey: ["audit", p.workspaceId],
    queryFn: () => apiGet<{ entries: { id: string; action: string; target: string | null; actorUserId: string | null; createdAt: string; meta: Record<string, unknown> }[] }>(`/api/v1/workspaces/${p.workspaceId}/audit`),
    enabled: p.can("admin"),
  });
  return (
    <div className="mx-auto max-w-[1100px] space-y-5">
      <PageHeader title="Data & usage" description="AI spend, API usage, storage and audit log." />
      <Section title={`AI usage since ${u.data ? fmtTime(u.data.ai.total.since) : "…"}`}>
        <Table>
          <thead>
            <tr>
              <Th>Provider</Th>
              <Th className="text-right">Input tokens</Th>
              <Th className="text-right">Output tokens</Th>
              <Th className="text-right">Budget used</Th>
            </tr>
          </thead>
          <tbody>
            {(u.data?.ai.providers ?? []).map((x) => (
              <tr key={x.id}>
                <Td>{x.label}</Td>
                <Td className="tnum text-right">{fmtInt(x.usage.inputTokens)}</Td>
                <Td className="tnum text-right">{fmtInt(x.usage.outputTokens)}</Td>
                <Td className="tnum text-right">{(((x.usage.inputTokens + x.usage.outputTokens) / x.budget) * 100).toFixed(1)}%</Td>
              </tr>
            ))}
          </tbody>
        </Table>
        <p className="px-4 py-2 text-[12px] text-ink-3">{u.data?.note}</p>
      </Section>
      <Section title="Sources">
        <Table>
          <thead>
            <tr>
              <Th>Source</Th>
              <Th>Status</Th>
              <Th className="text-right">Requests ok / err / 429 (this process)</Th>
              <Th className="text-right">PostHog query budget (last hour)</Th>
              <Th className="text-right">Stored events</Th>
            </tr>
          </thead>
          <tbody>
            {(u.data?.sources ?? []).map((s) => (
              <tr key={s.id}>
                <Td>{s.label}</Td>
                <Td>{s.status}</Td>
                <Td className="tnum text-right">
                  {s.stats.ok} / {s.stats.errors} / {s.stats.rateLimited}
                </Td>
                <Td className="tnum text-right">{s.posthogBudget ? `${s.posthogBudget.query?.lastHour ?? 0} of ${s.posthogBudget.query?.limitPerHour ?? "?"}` : "—"}</Td>
                <Td className="tnum text-right">{s.storage ? fmtInt(s.storage.events) : "—"}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Section>
      {p.can("admin") && (
        <Section title="Audit log (latest 200)">
          <Table>
            <thead>
              <tr>
                <Th>When</Th>
                <Th>Action</Th>
                <Th>Target</Th>
                <Th>Details</Th>
              </tr>
            </thead>
            <tbody>
              {(audit.data?.entries ?? []).map((e) => (
                <tr key={e.id}>
                  <Td className="whitespace-nowrap text-ink-2">{fmtTime(e.createdAt)}</Td>
                  <Td className="font-mono text-[12px]">{e.action}</Td>
                  <Td className="max-w-[200px] truncate font-mono text-[11px] text-ink-3">{e.target}</Td>
                  <Td className="max-w-[320px] truncate font-mono text-[11px] text-ink-3">{JSON.stringify(e.meta)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Section>
      )}
    </div>
  );
}
