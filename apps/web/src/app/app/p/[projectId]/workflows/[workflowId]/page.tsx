"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Power, Send, Trash2 } from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { EventInput } from "@/components/analytics-controls";
import { cleanConditions, ConditionEditor, StatusBadge, type Condition } from "@/components/products/shared";
import type { WorkflowRow, WorkflowRunRow } from "@/components/products/types";
import { useProject } from "@/components/project-context";
import { RowMenu } from "@/components/row-menu";
import { Badge, Button, Empty, ErrorBox, Field, Input, PageHeader, Section, Segmented, Spinner, Table, Td, Th } from "@/components/ui";
import { apiGet, apiSend } from "@/lib/api";
import { fmtRelative } from "@/lib/format";

type Draft = { name: string; enabled: boolean; event: string | null; filters: Condition[]; type: "slack" | "webhook"; url: string; message: string };
const EMPTY: Draft = { name: "", enabled: true, event: null, filters: [], type: "slack", url: "", message: "*{event}* from `{distinct_id}`" };

export default function WorkflowPage() {
  const p = useProject();
  const qc = useQueryClient();
  const router = useRouter();
  const { workflowId } = useParams<{ workflowId: string }>();
  const isNew = workflowId === "new";
  const url = `/api/v1/projects/${p.projectId}/workflows/${workflowId}`;
  const q = useQuery({
    queryKey: ["workflow", workflowId],
    queryFn: () => apiGet<{ workflow: WorkflowRow; runs: WorkflowRunRow[] }>(url),
    enabled: !isNew,
    refetchInterval: (s) => (s.state.data?.runs.some((r) => r.status === "pending") ? 2000 : 15_000),
  });
  const w = q.data?.workflow;
  const [d, setD] = useState<Draft>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const fromRow = (x: WorkflowRow): Draft => ({ name: x.name, enabled: x.enabled, event: x.trigger.event, filters: x.trigger.filters as Condition[], type: x.action.type, url: x.action.url, message: x.action.message ?? EMPTY.message });
  useEffect(() => {
    if (w) setD(fromRow(w));
  }, [w]);
  const dirty = isNew || (w ? JSON.stringify(d) !== JSON.stringify(fromRow(w)) : false);
  const set = (patch: Partial<Draft>) => {
    setSaved(false);
    setD((x) => ({ ...x, ...patch }));
  };
  const member = p.can("member");

  const save = async () => {
    setSaving(true);
    setErr(null);
    const body = {
      name: d.name.trim(),
      enabled: d.enabled,
      trigger: { type: "event", event: d.event, filters: cleanConditions(d.filters) },
      action: { type: d.type, url: d.url.trim(), ...(d.type === "slack" ? { message: d.message } : {}) },
    };
    try {
      if (isNew) {
        const r = await apiSend<{ workflow: WorkflowRow }>(`/api/v1/projects/${p.projectId}/workflows`, "POST", body);
        await qc.invalidateQueries({ queryKey: ["workflows", p.projectId] });
        router.replace(p.href(`workflows/${r.workflow.id}`));
      } else {
        await apiSend(url, "PATCH", body);
        await qc.invalidateQueries({ queryKey: ["workflow", workflowId] });
        await qc.invalidateQueries({ queryKey: ["workflows", p.projectId] });
        setSaved(true);
      }
    } catch (e) {
      setErr(e);
    } finally {
      setSaving(false);
    }
  };

  if (!isNew && q.isLoading) return <Spinner />;
  if (!isNew && !w) return <ErrorBox error={q.error ?? new Error("Workflow not found")} />;
  const runs = q.data?.runs ?? [];

  return (
    <div className="mx-auto max-w-[1000px] space-y-5">
      <Link href={p.href("workflows")} className="inline-flex items-center gap-1 text-[13px] text-ink-3 hover:text-ink">
        <ArrowLeft size={13} /> Workflows
      </Link>
      <PageHeader
        title={
          isNew ? (
            "New workflow"
          ) : (
            <span className="flex items-center gap-2">
              {w!.name} <StatusBadge status={w!.enabled ? "on" : "off"} />
            </span>
          )
        }
        actions={
          member && (
            <div className="flex items-center gap-2">
              {saved && !dirty && <span className="text-[12px] text-pos">Saved</span>}
              {dirty && (
                <Button variant="primary" loading={saving} onClick={save} disabled={!d.name.trim() || !d.event || !d.url.trim()}>
                  {isNew ? "Create workflow" : "Save changes"}
                </Button>
              )}
              {!isNew && (
                <RowMenu
                  items={[
                    {
                      label: "Send a test",
                      icon: <Send size={14} />,
                      onSelect: async () => {
                        setTesting(true);
                        try {
                          await apiSend(`${url}/test`, "POST");
                          await qc.invalidateQueries({ queryKey: ["workflow", workflowId] });
                        } catch (e) {
                          setErr(e);
                        } finally {
                          setTesting(false);
                        }
                      },
                    },
                    { label: d.enabled ? "Turn off" : "Turn on", icon: <Power size={14} />, onSelect: () => set({ enabled: !d.enabled }) },
                    {
                      label: "Delete workflow",
                      icon: <Trash2 size={14} />,
                      danger: true,
                      onSelect: async () => {
                        if (!confirm(`Delete "${w!.name}" and its run history?`)) return;
                        try {
                          await apiSend(url, "DELETE");
                          await qc.invalidateQueries({ queryKey: ["workflows", p.projectId] });
                          router.push(p.href("workflows"));
                        } catch (e) {
                          setErr(e);
                        }
                      },
                    },
                  ]}
                />
              )}
            </div>
          )
        }
      />
      {err != null && <ErrorBox error={err} />}

      <Section title="Name">
        <div className="p-5">
          <Input aria-label="Name" value={d.name} disabled={!member} placeholder="Tell #sales about upgrades" onChange={(e) => set({ name: e.target.value })} className="max-w-md" />
        </div>
      </Section>

      <Section title="When">
        <div className="space-y-4 p-5">
          <Field label="This event is captured">{() => <EventInput value={d.event} onChange={(v) => set({ event: v })} label="Trigger event" />}</Field>
          <div>
            <p className="mb-2 text-[12px] font-medium text-ink-2">Only if its properties match (optional)</p>
            <ConditionEditor conditions={d.filters} onChange={(f) => set({ filters: f })} ops={["eq", "neq", "contains", "is_set", "gt", "lt"]} placeholder="plan" disabled={!member} addLabel="Add a filter" />
          </div>
        </div>
      </Section>

      <Section title="Then">
        <div className="space-y-4 p-5">
          <Segmented
            label="Action"
            value={d.type}
            onChange={(t) => set({ type: t })}
            options={[
              { value: "slack", label: "Post to Slack" },
              { value: "webhook", label: "Call a webhook" },
            ]}
          />
          <Field
            label={d.type === "slack" ? "Slack incoming-webhook URL" : "Webhook URL"}
            hint={
              d.type === "slack" ? (
                <>
                  Create one at{" "}
                  <a className="underline" href="https://api.slack.com/messaging/webhooks" target="_blank" rel="noreferrer">
                    api.slack.com/messaging/webhooks
                  </a>{" "}
                  and pick the channel.
                </>
              ) : (
                "We POST the event as JSON. Your endpoint should answer 2xx; failures retry 3 times over ~12 minutes."
              )
            }
          >
            {(id) => <Input id={id} value={d.url} disabled={!member} placeholder={d.type === "slack" ? "https://hooks.slack.com/services/…" : "https://example.com/hooks/hostpog"} onChange={(e) => set({ url: e.target.value })} />}
          </Field>
          {d.type === "slack" ? (
            <Field label="Message" hint={<>Use {"{event}"}, {"{distinct_id}"}, {"{timestamp}"} and {"{properties.plan}"} for any event property.</>}>
              {(id) => <textarea id={id} rows={3} value={d.message} disabled={!member} onChange={(e) => set({ message: e.target.value })} className="w-full rounded-lg border border-line bg-panel px-2.5 py-2 font-mono text-[12px]" />}
            </Field>
          ) : (
            <pre className="overflow-x-auto rounded-lg border border-line bg-panel-2 p-3 font-mono text-[12px] text-ink-2">{`POST ${d.url || "<your URL>"}
{
  "workflow": { "id": "…", "name": "${d.name || "…"}" },
  "event": { "event": "${d.event ?? "…"}", "distinct_id": "…", "timestamp": "…", "properties": { … } },
  "sent_at": "…"
}`}</pre>
          )}
        </div>
      </Section>

      {!isNew && (
        <Section
          title="Runs"
          actions={
            member && (
              <Button
                size="sm"
                loading={testing}
                onClick={async () => {
                  setTesting(true);
                  try {
                    await apiSend(`${url}/test`, "POST");
                    await qc.invalidateQueries({ queryKey: ["workflow", workflowId] });
                  } catch (e) {
                    setErr(e);
                  } finally {
                    setTesting(false);
                  }
                }}
              >
                <Send size={13} /> Send a test
              </Button>
            )
          }
        >
          {!runs.length ? (
            <div className="p-4">
              <Empty title="No runs yet">
                Runs appear when <code>{w!.trigger.event}</code> happens{w!.trigger.filters.length ? " and matches the filters" : ""}. Send a test to check the destination.
              </Empty>
            </div>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>When</Th>
                  <Th>Status</Th>
                  <Th>Event</Th>
                  <Th>Result</Th>
                </tr>
              </thead>
              <tbody>
                {runs.map((r) => (
                  <tr key={r.id}>
                    <Td className="text-[12px] text-ink-3">{fmtRelative(r.createdAt)}</Td>
                    <Td>
                      <div className="flex items-center gap-1.5">
                        <StatusBadge status={r.status === "success" ? "delivered" : r.status} />
                        {r.test && <Badge>test</Badge>}
                      </div>
                    </Td>
                    <Td className="font-mono text-[12px]">
                      {r.event.event} <span className="text-ink-3">· {r.event.distinct_id}</span>
                    </Td>
                    <Td className="text-[12px] text-ink-2">
                      {r.status === "pending" ? (r.attempts ? `Retrying (attempt ${r.attempts + 1})… ${r.error ?? ""}` : "Sending…") : r.error ? `${r.error}${r.attempts > 1 ? ` after ${r.attempts} attempts` : ""}` : `Delivered${r.responseStatus ? ` (${r.responseStatus})` : ""}`}
                    </Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Section>
      )}
    </div>
  );
}
