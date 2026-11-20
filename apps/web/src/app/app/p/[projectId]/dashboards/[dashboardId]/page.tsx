"use client";
import type { AnalyticsQuery, FunnelResult, RetentionResult, TopValuesResult, TrendResult } from "@hostpog/contracts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Pencil, Trash2 } from "lucide-react";
import { RowMenu } from "@/components/row-menu";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { QueryState } from "@/components/analytics-controls";
import { FunnelBars, RetentionMatrix, TopTable, TrendView } from "@/components/insight-views";
import { useProject } from "@/components/project-context";
import { Provenance } from "@/components/provenance";
import { Button, Empty, ErrorBox, Input, PageHeader, Section } from "@/components/ui";
import { apiGet, apiSend, useAnalytics } from "@/lib/api";

interface Tile {
  id: string;
  position: number;
  insight: { id: string; name: string; query: AnalyticsQuery; sourceId: string | null };
}

function TileView({ tile, sourceId, range }: { tile: Tile; sourceId: string | null; range: string }) {
  const p = useProject();
  // dashboard-wide date range overrides the saved one; the saved source wins unless removed
  const q = { ...tile.insight.query, dateRange: { from: range, to: "now" } } as AnalyticsQuery;
  const src = tile.insight.sourceId && p.sources.some((s) => s.id === tile.insight.sourceId) ? tile.insight.sourceId : sourceId;
  const r = useAnalytics(p.projectId, src, q);
  const res = r.data?.result;
  return (
    <QueryState q={r}>
      {res && q.kind === "trend" && (
        <div className="px-2 pt-2">
          <TrendView result={res as TrendResult} height={220} />
        </div>
      )}
      {res && q.kind === "funnel" && <FunnelBars result={res as FunnelResult} />}
      {res && q.kind === "retention" && <RetentionMatrix result={res as RetentionResult} />}
      {res && q.kind === "top" && <TopTable result={res as TopValuesResult} label="Value" />}
      <Provenance env={r.data} />
    </QueryState>
  );
}

export default function Dashboard() {
  const p = useProject();
  const router = useRouter();
  const qc = useQueryClient();
  const { dashboardId } = useParams<{ dashboardId: string }>();
  const [renaming, setRenaming] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const key = ["dashboard", p.projectId, dashboardId];
  const q = useQuery({ queryKey: key, queryFn: () => apiGet<{ dashboard: { id: string; name: string }; tiles: Tile[] }>(`/api/v1/projects/${p.projectId}/dashboards/${dashboardId}`) });
  const patch = async (body: unknown) => {
    setErr(null);
    try {
      await apiSend(`/api/v1/projects/${p.projectId}/dashboards/${dashboardId}`, "PATCH", body);
      await qc.invalidateQueries({ queryKey: key });
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  if (q.error) return <ErrorBox error={q.error} />;
  const tiles = q.data?.tiles ?? [];
  const move = (i: number, d: -1 | 1) => {
    const ids = tiles.map((t) => t.id);
    const j = i + d;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    void patch({ order: ids });
  };
  return (
    <div className="mx-auto max-w-[1280px]">
      <Link href={p.href("dashboards")} className="text-[13px] text-ink-3 hover:text-ink">
        ← Dashboards
      </Link>
      <PageHeader
        title={
          renaming === null ? (
            <span className="group inline-flex items-center gap-1.5">
              {q.data?.dashboard.name ?? "…"}
              {p.can("member") && q.data && (
                <button
                  aria-label="Rename dashboard"
                  onClick={() => setRenaming(q.data?.dashboard.name ?? "")}
                  className="rounded p-1 text-ink-3 opacity-60 hover:bg-panel-2 hover:text-ink hover:opacity-100 group-hover:opacity-100"
                >
                  <Pencil size={14} />
                </button>
              )}
            </span>
          ) : (
            <form
              className="flex items-center gap-1.5"
              onSubmit={(e) => {
                e.preventDefault();
                if (renaming.trim()) void patch({ name: renaming.trim() }).then(() => setRenaming(null));
              }}
            >
              <Input
                autoFocus
                aria-label="Dashboard name"
                value={renaming}
                onChange={(e) => setRenaming(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setRenaming(null)}
                className="h-9 w-[280px] text-[18px] font-semibold"
              />
              <Button size="sm" type="submit" variant="primary" disabled={!renaming.trim()}>
                Save
              </Button>
              <Button size="sm" type="button" variant="ghost" onClick={() => setRenaming(null)}>
                Cancel
              </Button>
            </form>
          )
        }
        actions={
          p.can("member") && (
            <RowMenu
              items={[
                { label: "Rename", icon: <Pencil size={14} />, onSelect: () => setRenaming(q.data?.dashboard.name ?? "") },
                {
                  label: "Delete dashboard",
                  icon: <Trash2 size={14} />,
                  danger: true,
                  onSelect: async () => {
                    if (!confirm("Delete this dashboard? Saved insights are kept.")) return;
                    await apiSend(`/api/v1/projects/${p.projectId}/dashboards/${dashboardId}`, "DELETE");
                    router.push(p.href("dashboards"));
                  },
                },
              ]}
            />
          )
        }
      />
      {err && <ErrorBox error={err} />}
      {q.data && !tiles.length && <Empty title="This dashboard is empty">Open Trends, Funnels or Retention, then choose Save → this dashboard.</Empty>}
      <div className="grid gap-5 lg:grid-cols-2">
        {tiles.map((t, i) => (
          <Section
            key={t.id}
            title={t.insight.name}
            actions={
              p.can("member") && (
                <RowMenu
                  label="Tile actions"
                  items={[
                    { label: "Move up", icon: <ArrowUp size={14} />, onSelect: () => move(i, -1), hidden: i === 0 },
                    { label: "Move down", icon: <ArrowDown size={14} />, onSelect: () => move(i, 1), hidden: i === tiles.length - 1 },
                    { label: "Remove from dashboard", icon: <Trash2 size={14} />, danger: true, onSelect: () => void patch({ removeTileId: t.id }) },
                  ]}
                />
              )
            }
          >
            <TileView tile={t} sourceId={p.sourceId} range={p.range} />
          </Section>
        ))}
      </div>
    </div>
  );
}
