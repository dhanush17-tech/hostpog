"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Power, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { StatusBadge } from "@/components/products/shared";
import { describeAction, type WorkflowRow } from "@/components/products/types";
import { useProject } from "@/components/project-context";
import { RowMenu } from "@/components/row-menu";
import { Badge, Button, Empty, ErrorBox, PageHeader, Section, Spinner, Table, Td, Th } from "@/components/ui";
import { apiGet, apiSend } from "@/lib/api";
import { fmtRelative } from "@/lib/format";

export default function Workflows() {
  const p = useProject();
  const qc = useQueryClient();
  const router = useRouter();
  const [err, setErr] = useState<unknown>(null);
  const base = `/api/v1/projects/${p.projectId}/workflows`;
  const q = useQuery({ queryKey: ["workflows", p.projectId], queryFn: () => apiGet<{ workflows: WorkflowRow[] }>(base) });
  const list = q.data?.workflows ?? [];
  const member = p.can("member");
  const newButton = member && (
    <Link href={p.href("workflows/new")}>
      <Button variant="primary">
        <Plus size={14} /> New workflow
      </Button>
    </Link>
  );

  return (
    <div className="mx-auto max-w-[1100px] space-y-5">
      <PageHeader title="Workflows" description="When something happens in your product, tell Slack or call your own webhook." actions={list.length > 0 && newButton} />
      {err != null && <ErrorBox error={err} />}
      {q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : !list.length ? (
        <Section>
          <div className="p-4">
            <Empty title="No workflows yet" action={newButton}>
              For example: post in #sales when someone upgrades, or call your CRM when a trial signs up. Runs within seconds of the event.
            </Empty>
          </div>
        </Section>
      ) : (
        <Section>
          <Table>
            <thead>
              <tr>
                <Th>Workflow</Th>
                <Th>Status</Th>
                <Th>When</Th>
                <Th>Then</Th>
                <Th className="text-right">Last run</Th>
                <Th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {list.map((w) => (
                <tr key={w.id} className="cursor-pointer hover:bg-panel-2" onClick={() => router.push(p.href(`workflows/${w.id}`))}>
                  <Td className="font-medium">{w.name}</Td>
                  <Td>
                    <div className="flex items-center gap-1.5">
                      <StatusBadge status={w.enabled ? "on" : "off"} />
                      {(w.recentFailures ?? 0) > 0 && <Badge tone="neg">{w.recentFailures} failed</Badge>}
                    </div>
                  </Td>
                  <Td className="font-mono text-[12px]">
                    {w.trigger.event}
                    {w.trigger.filters.length > 0 && <span className="font-sans text-ink-3"> + {w.trigger.filters.length} filter{w.trigger.filters.length > 1 ? "s" : ""}</span>}
                  </Td>
                  <Td className="text-[13px] text-ink-2">{describeAction(w.action)}</Td>
                  <Td className="text-right text-[12px] text-ink-3">{w.lastRunAt ? fmtRelative(w.lastRunAt) : "never"}</Td>
                  <Td onClick={(e) => e.stopPropagation()}>
                    {member && (
                      <RowMenu
                        label={`Actions for ${w.name}`}
                        items={[
                          { label: "Edit", icon: <Pencil size={14} />, onSelect: () => router.push(p.href(`workflows/${w.id}`)) },
                          {
                            label: w.enabled ? "Turn off" : "Turn on",
                            icon: <Power size={14} />,
                            onSelect: async () => {
                              try {
                                await apiSend(`${base}/${w.id}`, "PATCH", { enabled: !w.enabled });
                                await qc.invalidateQueries({ queryKey: ["workflows", p.projectId] });
                              } catch (e) {
                                setErr(e);
                              }
                            },
                          },
                          {
                            label: "Delete",
                            icon: <Trash2 size={14} />,
                            danger: true,
                            onSelect: async () => {
                              if (!confirm(`Delete "${w.name}" and its run history?`)) return;
                              try {
                                await apiSend(`${base}/${w.id}`, "DELETE");
                                await qc.invalidateQueries({ queryKey: ["workflows", p.projectId] });
                              } catch (e) {
                                setErr(e);
                              }
                            },
                          },
                        ]}
                      />
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Section>
      )}
    </div>
  );
}
