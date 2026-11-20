"use client";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, Check, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { apiGet } from "@/lib/api";
import { usePendingQuestion } from "@/lib/pending-question";
import { useProject } from "./project-context";
import { cx } from "./ui";

const hiddenKey = (projectId: string) => `hostpog:setup-hidden:${projectId}`;

export function showSetupGuide(projectId: string) {
  try {
    localStorage.removeItem(hiddenKey(projectId));
  } catch {}
  window.dispatchEvent(new Event("hostpog:setup-shown"));
}

interface Step {
  id: string;
  title: string;
  why: string;
  href: string;
  cta: string;
  done: boolean;
  optional?: boolean;
}

/**
 * First-run checklist on the overview. Shows remaining distance, recommends one next step,
 * lets every step be skipped, and disappears once the required steps are done (or when hidden).
 */
export function SetupGuide() {
  const p = useProject();
  const [pending] = usePendingQuestion();
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    const read = () => {
      try {
        setHidden(localStorage.getItem(hiddenKey(p.projectId)) === "1");
      } catch {
        setHidden(false);
      }
    };
    read();
    window.addEventListener("hostpog:setup-shown", read);
    return () => window.removeEventListener("hostpog:setup-shown", read);
  }, [p.projectId]);

  const providers = useQuery({
    queryKey: ["ai-providers", p.workspaceId],
    queryFn: () => apiGet<{ providers: { enabled: boolean }[] }>(`/api/v1/workspaces/${p.workspaceId}/ai-providers`),
    enabled: !hidden,
  });
  const inv = useQuery({
    queryKey: ["investigations", p.projectId],
    queryFn: () => apiGet<{ investigations: { id: string }[] }>(`/api/v1/projects/${p.projectId}/investigations`),
    enabled: !hidden,
  });
  const members = useQuery({
    queryKey: ["members", p.workspaceId],
    queryFn: () => apiGet<{ members: { userId: string }[] }>(`/api/v1/workspaces/${p.workspaceId}/members`),
    enabled: !hidden,
  });

  if (hidden || p.sourcesLoading || !providers.data || !inv.data || !members.data) return null;

  const steps: Step[] = [
    {
      id: "data",
      title: "Connect your own data",
      why: "Swap sample data for your real numbers — PostHog or our SDK.",
      href: `/app/onboarding?project=${p.projectId}`,
      cta: "Connect",
      done: p.sources.some((s) => s.kind !== "demo" && s.status !== "disconnected"),
    },
    {
      id: "ai",
      title: "Add an AI model",
      why: "Lets you ask questions in plain English. Uses your own key.",
      href: p.href("settings/ai"),
      cta: "Add key",
      done: providers.data.providers.some((x) => x.enabled),
    },
    {
      id: "ask",
      title: pending ? `Ask: “${pending.length > 60 ? `${pending.slice(0, 57)}…` : pending}”` : "Ask your first question",
      why: "Get an answer with the charts and queries behind it.",
      href: p.href("investigations"),
      cta: "Ask",
      done: inv.data.investigations.length > 0,
    },
    {
      id: "team",
      title: "Invite a teammate",
      why: "Share dashboards and findings with your team.",
      href: p.href("settings/team"),
      cta: "Invite",
      done: members.data.members.length > 1,
      optional: true,
    },
  ];
  const required = steps.filter((s) => !s.optional);
  if (required.every((s) => s.done)) return null;
  const doneCount = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done)!;
  const left = steps.length - doneCount;

  const hide = () => {
    try {
      localStorage.setItem(hiddenKey(p.projectId), "1");
    } catch {}
    setHidden(true);
  };

  return (
    <section aria-label="Setup" className="mb-6 overflow-hidden rounded-xl border border-line bg-panel shadow-card">
      <div className="flex items-start justify-between gap-3 px-5 pt-4">
        <div>
          <h2 className="text-[14px] font-semibold tracking-tight">Finish setting up</h2>
          <p className="mt-0.5 text-[13px] text-ink-3">
            {doneCount} of {steps.length} done · {left} {left === 1 ? "step" : "steps"} left
          </p>
        </div>
        <button onClick={hide} className="inline-flex h-7 items-center gap-1 rounded-lg px-2 text-[12px] text-ink-3 hover:bg-panel-2 hover:text-ink" title="Hide setup — bring it back from the account menu">
          <X size={13} aria-hidden /> Hide
        </button>
      </div>
      <div className="mx-5 mt-3 h-1.5 overflow-hidden rounded-full bg-panel-2" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={doneCount} aria-label="Setup progress">
        <div className="h-full rounded-full bg-[var(--chart-1)] transition-all" style={{ width: `${(doneCount / steps.length) * 100}%` }} />
      </div>
      <ol className="mt-3 divide-y divide-line border-t border-line">
        {steps.map((s, i) => {
          const isNext = s.id === next.id;
          return (
            <li key={s.id} className={cx("flex items-center gap-3 px-5 py-3", isNext && "bg-brand-soft/40")}>
              <span
                className={cx(
                  "flex size-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold",
                  s.done ? "bg-[var(--chart-1)] text-white" : isNext ? "border-2 border-[var(--chart-1)] text-brand-deep" : "border border-line-strong text-ink-3",
                )}
                aria-hidden
              >
                {s.done ? <Check size={13} strokeWidth={3} /> : i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className={cx("truncate text-[13px] font-medium", s.done && "text-ink-3 line-through decoration-ink-3/40")}>
                  {s.title}
                  {s.optional && <span className="ml-1.5 font-normal text-ink-3">· optional</span>}
                  <span className="sr-only">{s.done ? " — done" : isNext ? " — recommended next" : ""}</span>
                </p>
                {!s.done && <p className="truncate text-[12px] text-ink-3">{s.why}</p>}
              </div>
              {!s.done && (
                <Link
                  href={s.href}
                  className={cx(
                    "inline-flex h-7 shrink-0 items-center gap-1 rounded-lg px-2.5 text-[12px] font-medium",
                    isNext ? "bg-primary text-primary-foreground hover:bg-primary/90" : "border border-line bg-panel text-ink hover:bg-panel-2",
                  )}
                >
                  {s.cta} {isNext && <ArrowRight size={12} aria-hidden />}
                </Link>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
