"use client";
import { useQuery } from "@tanstack/react-query";
import {
  ArrowUp,
  BarChart3,
  BrainCircuit,
  Filter,
  FlaskConical,
  Globe,
  LayoutDashboard,
  MessageSquareText,
  ScrollText,
  Sparkles,
  ToggleRight,
  TrendingDown,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { openAssistant } from "./assistant";
import { Mark } from "./brand";
import { useProject } from "./project-context";
import { sourceName, useCurrentUser } from "./shell";
import { Kbd } from "./ui";
import { apiGet } from "@/lib/api";
import { rangeLabel } from "@/lib/format";

const AREAS: { label: string; path: string; icon: LucideIcon; tint: string }[] = [
  { label: "Trends", path: "trends", icon: BarChart3, tint: "text-[#3b82f6]" },
  { label: "Funnels", path: "funnels", icon: Filter, tint: "text-[#6366f1]" },
  { label: "Web analytics", path: "web", icon: Globe, tint: "text-[#14b8a6]" },
  { label: "Feature flags", path: "flags", icon: ToggleRight, tint: "text-[#0ea5e9]" },
  { label: "Experiments", path: "experiments", icon: FlaskConical, tint: "text-[#a855f7]" },
  { label: "Surveys", path: "surveys", icon: MessageSquareText, tint: "text-[#f43f5e]" },
  { label: "LLM analytics", path: "llm", icon: BrainCircuit, tint: "text-[#f26a12]" },
  { label: "Logs", path: "logs", icon: ScrollText, tint: "text-[#64748b]" },
];

const ASK: { icon: LucideIcon; tint: string; title: string; sub: string; prompt: string }[] = [
  { icon: TrendingDown, tint: "text-[#3b82f6]", title: "What changed this week?", sub: "Biggest moves in users and events vs last week", prompt: "What changed this week compared to last week? Look at users and the top events and tell me the biggest moves." },
  { icon: Filter, tint: "text-[#6366f1]", title: "Find the drop-off", sub: "Where people leave between signup and activation", prompt: "Where do people drop off between signing up and becoming active? Build the funnel from our events." },
  { icon: ToggleRight, tint: "text-[#0ea5e9]", title: "Roll out a feature", sub: "A flag at 10% that you turn on when ready", prompt: "Create a feature flag for a new feature, rolled out to 10% of users." },
  { icon: MessageSquareText, tint: "text-[#f43f5e]", title: "Launch an NPS survey", sub: "Score from 0 to 10 plus the reason behind it", prompt: "Make an NPS survey: how likely are you to recommend us (0-10), then ask for the main reason for the score." },
];

function greeting(d = new Date()) {
  const h = d.getHours();
  return h < 5 ? "Working late" : h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

/** Home: greeting, one box to ask anything (goes to the assistant), and shortcuts into each product area. */
export function HomeHero() {
  const p = useProject();
  const user = useCurrentUser();
  const [q, setQ] = useState("");
  const [hello, setHello] = useState("Welcome back");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => setHello(greeting()), []); // client clock, after hydration
  const first = user?.name?.trim().split(/\s+/)[0];

  const submit = () => {
    const text = q.trim();
    if (!text) return input.current?.focus();
    openAssistant(text, { send: true });
    setQ("");
  };

  return (
    <section className="mx-auto max-w-[900px] pb-2 pt-4 text-center">
      <div className="flex justify-center">
        <Mark size={36} />
      </div>
      <h1 className="mt-4 text-[28px] font-semibold tracking-[-0.03em]">
        {hello}
        {first ? `, ${first}` : ""}
      </h1>
      <p className="mt-1.5 inline-flex flex-wrap items-center justify-center gap-1.5 text-[13px] text-ink-3">
        {p.source ? (
          <>
            <span className={`inline-block size-1.5 rounded-full ${p.source.status === "active" ? "bg-pos" : "bg-neg"}`} aria-hidden />
            {p.projectName} · {sourceName(p.source)} · {rangeLabel(p.range)}
          </>
        ) : (
          <>{p.projectName} · connect a data source to get started</>
        )}
      </p>

      <form
        className="mx-auto mt-6 max-w-[720px]"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="flex items-center gap-2 rounded-2xl border border-line bg-panel py-2 pl-4 pr-2 text-left shadow-card focus-within:border-brand">
          <Sparkles size={16} className="shrink-0 text-brand" aria-hidden />
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ask about your product, or tell it what to set up"
            aria-label="Ask the assistant"
            className="h-9 min-w-0 flex-1 bg-transparent text-[14px] outline-none placeholder:text-ink-3 focus-visible:outline-none"
          />
          <span className="hidden items-center gap-1 text-[11px] text-ink-3 sm:inline-flex">
            <Kbd>⌘J</Kbd> anywhere
          </span>
          <button
            type="submit"
            aria-label="Ask"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-xl bg-accent-fill text-on-brand transition-opacity disabled:opacity-40"
            disabled={!q.trim()}
          >
            <ArrowUp size={15} />
          </button>
        </div>
      </form>

      <nav aria-label="Product areas" className="mt-4 flex flex-wrap justify-center gap-2">
        {AREAS.map((a) => (
          <Link key={a.path} href={p.href(a.path)} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 text-[13px] font-medium text-ink shadow-card hover:bg-panel-2">
            <a.icon size={14} className={a.tint} aria-hidden />
            {a.label}
          </Link>
        ))}
      </nav>
    </section>
  );
}

/** "Ask" shortcuts on the left, pinned dashboards on the right. */
export function HomeShortcuts() {
  const p = useProject();
  const dashboards = useQuery({
    queryKey: ["dashboards", p.projectId],
    queryFn: () => apiGet<{ dashboards: { id: string; name: string }[] }>(`/api/v1/projects/${p.projectId}/dashboards`),
    staleTime: 60_000,
  });
  const list = dashboards.data?.dashboards ?? [];
  return (
    <div className="grid gap-x-10 gap-y-6 px-1 md:grid-cols-[1.4fr_1fr]">
      <div>
        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
          <Sparkles size={12} aria-hidden /> Ask the assistant
        </p>
        <ul className="space-y-0.5">
          {ASK.map((a) => (
            <li key={a.title}>
              <button type="button" onClick={() => openAssistant(a.prompt, { send: true })} className="flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left hover:bg-panel-2">
                <a.icon size={16} className={`mt-0.5 shrink-0 ${a.tint}`} aria-hidden />
                <span>
                  <span className="block text-[13px] font-medium">{a.title}</span>
                  <span className="block text-[12px] text-ink-3">{a.sub}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div>
        <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-ink-3">
          <LayoutDashboard size={12} aria-hidden /> Dashboards
        </p>
        {list.length ? (
          <ul className="space-y-0.5">
            {list.slice(0, 5).map((d) => (
              <li key={d.id}>
                <Link href={p.href(`dashboards/${d.id}`)} className="flex items-center gap-2 rounded-lg px-2 py-2 text-[13px] hover:bg-panel-2">
                  <LayoutDashboard size={14} className="shrink-0 text-ink-3" aria-hidden />
                  <span className="truncate">{d.name}</span>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-2 py-2 text-[13px] text-ink-3">
            {dashboards.isLoading ? "Loading…" : (
              <>
                None yet. Save a chart from{" "}
                <Link href={p.href("trends")} className="font-medium text-ink underline-offset-2 hover:underline">
                  Trends
                </Link>{" "}
                to start one.
              </>
            )}
          </p>
        )}
      </div>
    </div>
  );
}
