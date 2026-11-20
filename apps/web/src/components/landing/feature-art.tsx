import { ArrowUp, Bell, CheckCircle2, Sparkles } from "lucide-react";
import Image from "next/image";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Peach backdrop with a product image bleeding off one edge, plus an optional floating card. */
export function FeatureFrame({ children, float, side = "left", className }: { children: ReactNode; float?: ReactNode; side?: "left" | "right"; className?: string }) {
  return (
    <div className={cn("relative", className)}>
      <div
        className={cn(
          "relative h-[300px] overflow-hidden rounded-[28px] bg-gradient-to-br from-[#ffe9d6] via-[#fff1e5] to-[#ffe2c8] sm:h-[380px] dark:from-[#2a1709] dark:via-[#1f130a] dark:to-[#2a1709]",
          side === "left" ? "pl-8 pt-8 sm:pl-10 sm:pt-10" : "pr-8 pt-8 sm:pr-10 sm:pt-10",
        )}
      >
        <div className={cn("h-full overflow-hidden border border-black/[0.06] bg-panel shadow-[0_20px_50px_-20px_rgb(120_60_10/0.35)]", side === "left" ? "rounded-tl-2xl" : "ml-auto rounded-tr-2xl")}>{children}</div>
      </div>
      {float}
    </div>
  );
}

export function Shot({ src, alt, position = "left top" }: { src: string; alt: string; position?: string }) {
  return (
    <div className="relative h-full w-[760px] max-w-none">
      <Image src={src} alt={alt} fill sizes="760px" className="object-cover" style={{ objectPosition: position }} />
    </div>
  );
}

/** Illustrative investigation thread rendered in HTML (not a screenshot). */
export function InvestigationArt() {
  return (
    <div className="flex h-full w-[620px] max-w-none flex-col gap-3 p-5 text-[12px]">
      <div className="ml-auto max-w-[320px] rounded-2xl rounded-br-md bg-panel-2 px-3.5 py-2.5 text-ink">Why did trial signups drop last week?</div>
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-lg bg-gradient-to-b from-[#ff9a52] to-[#f26a12] text-white">
          <Sparkles size={13} />
        </span>
        <div className="min-w-0 space-y-2.5">
          <p className="leading-5 text-ink">
            Signups fell <b>18%</b> week over week. Traffic was flat, so the drop is in conversion — and it&apos;s concentrated in <b>Safari 18</b> after Tuesday&apos;s release.
          </p>
          <div className="rounded-xl border border-line p-3">
            <div className="mb-2 flex items-center justify-between text-[11px] text-ink-3">
              <span>signup → onboarding_started, by browser</span>
              <span>Last 14 days</span>
            </div>
            {[
              ["Chrome", 71, 70],
              ["Firefox", 68, 67],
              ["Safari", 66, 41],
            ].map(([b, before, after]) => (
              <div key={b as string} className="mb-1.5 grid grid-cols-[56px_1fr_56px] items-center gap-2">
                <span className="text-ink-2">{b}</span>
                <div className="relative h-2 rounded-full bg-panel-2">
                  <div className="absolute inset-y-0 left-0 rounded-full bg-[var(--chart-2)]/35" style={{ width: `${before}%` }} />
                  <div className={cn("absolute inset-y-0 left-0 rounded-full", b === "Safari" ? "bg-[var(--chart-1)]" : "bg-[var(--chart-2)]")} style={{ width: `${after}%` }} />
                </div>
                <span className={cn("tnum text-right", b === "Safari" ? "font-medium text-neg" : "text-ink-2")}>{after}%</span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {["Q1 · weekly signups", "Q2 · funnel by browser", "Q3 · release annotations"].map((c) => (
              <span key={c} className="rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-3">
                {c}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export function PromptChip({ children }: { children: ReactNode }) {
  return (
    <div className="absolute -bottom-6 left-6 right-6 flex items-center gap-2 rounded-2xl border border-line bg-panel p-2 pl-4 text-[13px] shadow-[0_16px_40px_-16px_rgb(0_0_0/0.25)] sm:right-auto sm:max-w-[420px]">
      <span className="min-w-0 flex-1 truncate">{children}</span>
      <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-b from-[#ff9a52] to-[#f26a12] text-white">
        <ArrowUp size={15} />
      </span>
    </div>
  );
}

export function AlertChip() {
  return (
    <div className="absolute -bottom-6 right-6 flex w-[300px] items-start gap-3 rounded-2xl border border-line bg-panel p-3 text-[12px] shadow-[0_16px_40px_-16px_rgb(0_0_0/0.25)]">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand-deep">
        <Bell size={15} />
      </span>
      <div className="min-w-0">
        <p className="flex items-center gap-1.5 font-medium text-ink">
          Checkout funnel <span className="rounded-full bg-[color-mix(in_srgb,var(--neg)_12%,transparent)] px-1.5 text-[10px] font-semibold text-neg">−12%</span>
        </p>
        <p className="mt-0.5 leading-4 text-ink-3">Drop-off at “payment_submitted” is up since yesterday.</p>
      </div>
    </div>
  );
}

export function LiveChip() {
  return (
    <div className="absolute -bottom-6 left-6 flex items-center gap-3 rounded-2xl border border-line bg-panel px-3.5 py-2.5 text-[12px] shadow-[0_16px_40px_-16px_rgb(0_0_0/0.25)]">
      <span className="relative flex size-2">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-pos opacity-60" />
        <span className="relative inline-flex size-2 rounded-full bg-pos" />
      </span>
      <span className="font-medium">signed_up</span>
      <span className="text-ink-3">Safari · /pricing · just now</span>
    </div>
  );
}

export function CodeArt() {
  return (
    <div className="h-full w-[640px] max-w-none bg-[#0f0f10] p-6 font-mono text-[12.5px] leading-6 text-zinc-300">
      <div className="mb-4 flex gap-1.5">
        <span className="size-2.5 rounded-full bg-zinc-700" />
        <span className="size-2.5 rounded-full bg-zinc-700" />
        <span className="size-2.5 rounded-full bg-zinc-700" />
      </div>
      <p>
        <span className="text-[#c792ea]">import</span> {"{ hostpog }"} <span className="text-[#c792ea]">from</span> <span className="text-[#c3e88d]">&quot;@hostpog/js&quot;</span>;
      </p>
      <p className="mt-3">
        hostpog.<span className="text-[#82aaff]">init</span>(<span className="text-[#c3e88d]">&quot;hp_pk_…&quot;</span>, {"{"}
      </p>
      <p className="pl-5">
        host: <span className="text-[#c3e88d]">&quot;https://events.your-domain.com&quot;</span>,
      </p>
      <p>{"});"}</p>
      <p className="mt-3">
        hostpog.<span className="text-[#82aaff]">capture</span>(<span className="text-[#c3e88d]">&quot;signed_up&quot;</span>, {"{ plan: "}
        <span className="text-[#c3e88d]">&quot;pro&quot;</span>
        {" });"}
      </p>
      <p className="mt-5 text-zinc-500"># or keep PostHog and connect it read-only</p>
      <p className="flex items-center gap-2 text-[#c3e88d]">
        <CheckCircle2 size={14} /> Connected · us.posthog.com · project 41823
      </p>
    </div>
  );
}
