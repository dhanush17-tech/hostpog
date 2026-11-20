"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { RowMenu } from "@/components/row-menu";
import { useState } from "react";
import { useProject } from "@/components/project-context";
import { Button, Empty, ErrorBox, Input, PageHeader, Section } from "@/components/ui";
import { apiGet, apiSend } from "@/lib/api";
import { fmtRelative } from "@/lib/format";

export default function Dashboards() {
  const p = useProject();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const q = useQuery({ queryKey: ["dashboards", p.projectId], queryFn: () => apiGet<{ dashboards: { id: string; name: string; updatedAt: string }[] }>(`/api/v1/projects/${p.projectId}/dashboards`) });
  const create = async () => {
    setErr(null);
    try {
      await apiSend(`/api/v1/projects/${p.projectId}/dashboards`, "POST", { name: name.trim() });
      setName("");
      await qc.invalidateQueries({ queryKey: ["dashboards", p.projectId] });
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const [adding, setAdding] = useState(false);
  const newForm = (
    <form
      className="flex items-center gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) void create().then(() => setAdding(false));
      }}
    >
      <Input autoFocus aria-label="Dashboard name" placeholder="e.g. Weekly growth" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setAdding(false)} className="w-[220px]" />
      <Button variant="primary" type="submit" disabled={!name.trim()}>
        Create
      </Button>
      <Button variant="ghost" type="button" onClick={() => setAdding(false)}>
        Cancel
      </Button>
    </form>
  );
  const newButton = (
    <Button variant="primary" onClick={() => setAdding(true)}>
      <Plus size={14} /> New dashboard
    </Button>
  );
  const empty = q.data && !q.data.dashboards.length;
  const remove = async (id: string) => {
    if (!confirm("Delete this dashboard? Saved insights are kept.")) return;
    await apiSend(`/api/v1/projects/${p.projectId}/dashboards/${id}`, "DELETE");
    await qc.invalidateQueries({ queryKey: ["dashboards", p.projectId] });
  };
  return (
    <div className="mx-auto max-w-[1280px]">
      <PageHeader title="Dashboards" actions={p.can("member") && !empty && (adding ? newForm : newButton)} />
      {err && <ErrorBox error={err} />}
      <Section>
        {empty ? (
          <div className="p-4">
            <Empty title="No dashboards yet" action={p.can("member") && <div className="mt-2">{adding ? newForm : newButton}</div>}>
              Make one, then use “Save” on any Trends, Funnels or Retention view to add charts to it.
            </Empty>
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {(q.data?.dashboards ?? []).map((d) => (
              <li key={d.id} className="flex items-center gap-2 pr-3 hover:bg-panel-2">
                <Link href={p.href(`dashboards/${d.id}`)} className="flex min-w-0 flex-1 items-center justify-between gap-3 px-4 py-3 text-[13px]">
                  <span className="truncate font-medium">{d.name}</span>
                  <span className="shrink-0 text-[12px] text-ink-3">updated {fmtRelative(d.updatedAt)}</span>
                </Link>
                {p.can("member") && <RowMenu label={`Actions for ${d.name}`} items={[{ label: "Delete", icon: <Trash2 size={14} />, danger: true, onSelect: () => void remove(d.id) }]} />}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
}
