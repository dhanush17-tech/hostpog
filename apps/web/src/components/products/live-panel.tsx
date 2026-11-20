"use client";
import { useQuery } from "@tanstack/react-query";
import { FlaskConical, MessageSquareText, ToggleRight, Workflow, type LucideIcon } from "lucide-react";
import Link from "next/link";
import { useProject } from "@/components/project-context";
import { Section, Skeleton } from "@/components/ui";
import { apiGet } from "@/lib/api";
import type { ExperimentRow, FlagRow, SurveyRow, WorkflowRow } from "./types";

/** "What's live in this project": one glance at flags, experiments, surveys and workflows, linking to each. */
export function LivePanel() {
  const p = useProject();
  const base = `/api/v1/projects/${p.projectId}`;
  const get = <T,>(path: string) => ({ queryKey: [path, p.projectId], queryFn: () => apiGet<T>(`${base}/${path}`), staleTime: 30_000 });
  const flags = useQuery(get<{ flags: FlagRow[] }>("flags"));
  const exps = useQuery(get<{ experiments: ExperimentRow[] }>("experiments"));
  const surveys = useQuery(get<{ surveys: SurveyRow[] }>("surveys"));
  const wfs = useQuery(get<{ workflows: WorkflowRow[] }>("workflows"));

  const tiles: { icon: LucideIcon; label: string; path: string; live?: number; total?: number; liveWord: string; empty: string }[] = [
    { icon: ToggleRight, label: "Feature flags", path: "flags", live: flags.data?.flags.filter((f) => f.active).length, total: flags.data?.flags.length, liveWord: "on", empty: "Roll out a feature" },
    { icon: FlaskConical, label: "Experiments", path: "experiments", live: exps.data?.experiments.filter((e) => e.status === "running").length, total: exps.data?.experiments.length, liveWord: "running", empty: "Test a change" },
    { icon: MessageSquareText, label: "Surveys", path: "surveys", live: surveys.data?.surveys.filter((s) => s.status === "active").length, total: surveys.data?.surveys.length, liveWord: "live", empty: "Ask your users" },
    { icon: Workflow, label: "Workflows", path: "workflows", live: wfs.data?.workflows.filter((w) => w.enabled).length, total: wfs.data?.workflows.length, liveWord: "on", empty: "Alert on an event" },
  ];

  return (
    <Section title="Live in this project">
      <div className="grid grid-cols-2 divide-line lg:grid-cols-4 lg:divide-x">
        {tiles.map((t) => (
          <Link key={t.path} href={p.href(t.path)} className="flex items-center gap-3 px-5 py-4 hover:bg-panel-2">
            <t.icon size={18} className="shrink-0 text-ink-3" aria-hidden />
            <span className="min-w-0">
              <span className="block text-[13px] font-medium">{t.label}</span>
              {t.total === undefined ? (
                <Skeleton className="mt-1 h-3 w-16" />
              ) : t.total === 0 ? (
                <span className="block text-[12px] text-ink-3">{t.empty}</span>
              ) : (
                <span className="block text-[12px] text-ink-2">
                  <span className="font-medium tabular-nums text-ink">{t.live}</span> {t.liveWord} · {t.total} total
                </span>
              )}
            </span>
          </Link>
        ))}
      </div>
    </Section>
  );
}
