"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FlaskConical, Pencil, Plus, Power, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { rolloutSummary, type FlagRow } from "@/components/products/types";
import { SetupCode, StatusBadge } from "@/components/products/shared";
import { useProject } from "@/components/project-context";
import { RowMenu } from "@/components/row-menu";
import { Badge, Button, Empty, ErrorBox, PageHeader, Section, Spinner, Table, Td, Th } from "@/components/ui";
import { apiGet, apiSend } from "@/lib/api";
import { fmtRelative } from "@/lib/format";

export default function Flags() {
  const p = useProject();
  const qc = useQueryClient();
  const router = useRouter();
  const [err, setErr] = useState<unknown>(null);
  const q = useQuery({ queryKey: ["flags", p.projectId], queryFn: () => apiGet<{ flags: FlagRow[] }>(`/api/v1/projects/${p.projectId}/flags`) });
  const refresh = () => qc.invalidateQueries({ queryKey: ["flags", p.projectId] });
  const base = `/api/v1/projects/${p.projectId}/flags`;
  const member = p.can("member");
  const flags = q.data?.flags ?? [];
  const newButton = member && (
    <Link href={p.href("flags/new")}>
      <Button variant="primary">
        <Plus size={14} /> New flag
      </Button>
    </Link>
  );

  return (
    <div className="mx-auto max-w-[1100px] space-y-5">
      <PageHeader title="Feature flags" description="Turn features on for some users, roll them out gradually, or switch them off instantly." actions={flags.length > 0 && newButton} />
      {err != null && <ErrorBox error={err} />}
      {q.isLoading ? (
        <Spinner />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : !flags.length ? (
        <Section>
          <div className="p-4">
            <Empty title="No feature flags yet" action={newButton}>
              Wrap a feature in a flag, then decide who sees it from here, without a deploy. Flags you used in PostHog keep their user buckets.
            </Empty>
          </div>
        </Section>
      ) : (
        <Section>
          <Table>
            <thead>
              <tr>
                <Th>Flag</Th>
                <Th>Status</Th>
                <Th>Who gets it</Th>
                <Th className="text-right">Updated</Th>
                <Th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {flags.map((f) => (
                <tr key={f.id} className="cursor-pointer hover:bg-panel-2" onClick={() => router.push(p.href(`flags/${f.id}`))}>
                  <Td>
                    <p className="font-mono text-[13px]">{f.key}</p>
                    {f.name && f.name !== f.key && <p className="text-[12px] text-ink-3">{f.name}</p>}
                  </Td>
                  <Td>
                    <div className="flex items-center gap-1.5">
                      <StatusBadge status={f.active ? "on" : "off"} />
                      {f.experiment && (
                        <Badge tone="brand">
                          <FlaskConical size={11} className="mr-1 inline" />
                          experiment
                        </Badge>
                      )}
                    </div>
                  </Td>
                  <Td className="text-[13px] text-ink-2">{rolloutSummary(f)}</Td>
                  <Td className="text-right text-[12px] text-ink-3">{fmtRelative(f.updatedAt)}</Td>
                  <Td onClick={(e) => e.stopPropagation()}>
                    {member && (
                      <RowMenu
                        label={`Actions for ${f.key}`}
                        items={[
                          { label: "Edit", icon: <Pencil size={14} />, onSelect: () => router.push(p.href(`flags/${f.id}`)) },
                          { label: "Open experiment", icon: <FlaskConical size={14} />, onSelect: () => router.push(p.href(`experiments/${f.experiment!.id}`)), hidden: !f.experiment },
                          {
                            label: f.active ? "Turn off" : "Turn on",
                            icon: <Power size={14} />,
                            onSelect: async () => {
                              try {
                                await apiSend(`${base}/${f.id}`, "PATCH", { active: !f.active });
                                await refresh();
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
                              if (!confirm(`Delete the flag "${f.key}"? Apps checking it will get false.`)) return;
                              try {
                                await apiSend(`${base}/${f.id}`, "DELETE");
                                await refresh();
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
        title="Check a flag in your app"
        sdks={["posthog", "hostpog", "node"]}
        code={(sdk, { init, key, host }) =>
          sdk === "node"
            ? `// any server: one POST per user\nconst { flags } = await fetch("${host}/v1/flags", {\n  method: "POST",\n  headers: { authorization: "Bearer ${key}", "content-type": "application/json" },\n  body: JSON.stringify({ distinct_id: userId }),\n}).then((r) => r.json());\n\nif (flags["my-flag"]) {\n  // show the new thing\n}`
            : `${init}\n\nif (${sdk === "posthog" ? "posthog" : "hostpog"}.isFeatureEnabled("my-flag")) {\n  // show the new thing\n}`
        }
        note="Already using posthog-js? Keep it. Point api_host at HostPog and your existing flag checks work unchanged."
      />
    </div>
  );
}
