"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pause, Pencil, Play, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { SetupCode, StatusBadge } from "@/components/products/shared";
import type { SurveyRow } from "@/components/products/types";
import { useProject } from "@/components/project-context";
import { RowMenu } from "@/components/row-menu";
import { Button, Empty, ErrorBox, PageHeader, Section, Spinner, Table, Td, Th } from "@/components/ui";
import { apiGet, apiSend } from "@/lib/api";
import { fmtRelative } from "@/lib/format";

export default function Surveys() {
  const p = useProject();
  const qc = useQueryClient();
  const router = useRouter();
  const [err, setErr] = useState<unknown>(null);
  const base = `/api/v1/projects/${p.projectId}/surveys`;
  const q = useQuery({ queryKey: ["surveys", p.projectId], queryFn: () => apiGet<{ surveys: SurveyRow[] }>(base) });
  const list = q.data?.surveys ?? [];
  const member = p.can("member");
  const act = async (id: string, action: "launch" | "stop") => {
    try {
      await apiSend(`${base}/${id}`, "PATCH", { action });
      await qc.invalidateQueries({ queryKey: ["surveys", p.projectId] });
    } catch (e) {
      setErr(e);
    }
  };
  const newButton = member && (
    <Link href={p.href("surveys/new")}>
      <Button variant="primary">
        <Plus size={14} /> New survey
      </Button>
    </Link>
  );

  return (
    <div className="mx-auto max-w-[1100px] space-y-5">
      <PageHeader title="Surveys" description="Ask users a quick question in your app: NPS, a rating, or what they'd like next." actions={list.length > 0 && newButton} />
      {err != null && <ErrorBox error={err} />}
      {q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : !list.length ? (
        <Section>
          <div className="p-4">
            <Empty title="No surveys yet" action={newButton}>
              Start from a template (NPS, satisfaction, open feedback). posthog-js shows it as a small popover; answers land here as events.
            </Empty>
          </div>
        </Section>
      ) : (
        <Section>
          <Table>
            <thead>
              <tr>
                <Th>Survey</Th>
                <Th>Status</Th>
                <Th>Questions</Th>
                <Th>Shown on</Th>
                <Th className="text-right">Updated</Th>
                <Th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {list.map((s) => (
                <tr key={s.id} className="cursor-pointer hover:bg-panel-2" onClick={() => router.push(p.href(`surveys/${s.id}`))}>
                  <Td className="font-medium">{s.name}</Td>
                  <Td>
                    <StatusBadge status={s.status} />
                  </Td>
                  <Td className="text-ink-2">{s.questions.length}</Td>
                  <Td className="text-[12px] text-ink-3">{s.urlContains ? <code>{s.urlContains}</code> : "every page"}</Td>
                  <Td className="text-right text-[12px] text-ink-3">{fmtRelative(s.updatedAt)}</Td>
                  <Td onClick={(e) => e.stopPropagation()}>
                    {member && (
                      <RowMenu
                        label={`Actions for ${s.name}`}
                        items={[
                          { label: "Edit", icon: <Pencil size={14} />, onSelect: () => router.push(p.href(`surveys/${s.id}?tab=edit`)) },
                          { label: s.status === "draft" ? "Launch" : "Resume", icon: <Play size={14} />, onSelect: () => void act(s.id, "launch"), hidden: s.status === "active" },
                          { label: "Stop", icon: <Pause size={14} />, onSelect: () => void act(s.id, "stop"), hidden: s.status !== "active" },
                          {
                            label: "Delete",
                            icon: <Trash2 size={14} />,
                            danger: true,
                            onSelect: async () => {
                              if (!confirm(`Delete "${s.name}"? Responses stay in your events.`)) return;
                              try {
                                await apiSend(`${base}/${s.id}`, "DELETE");
                                await qc.invalidateQueries({ queryKey: ["surveys", p.projectId] });
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
      <SetupCode
        title="Show surveys in your app"
        sdks={["posthog"]}
        code={(_sdk, { init }) => `${init}\n\n// That's it: active surveys appear automatically as a popover.\n// To render them yourself instead:\nposthog.getActiveMatchingSurveys((surveys) => { /* … */ });`}
        note="Surveys use posthog-js's built-in survey widget. The widget code loads from PostHog's public CDN; answers are sent only to HostPog."
      />
    </div>
  );
}
