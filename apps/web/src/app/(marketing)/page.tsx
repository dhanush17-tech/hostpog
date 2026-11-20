import { ArrowRight, Bot, BrainCircuit, CheckCircle2, Code2, FlaskConical, HelpCircle, KeyRound, Layers, Lock, MessageSquareText, Repeat, ScrollText, Server, Sparkles, ToggleRight, Workflow, XCircle } from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { Mark } from "@/components/brand";
import { BrandLogo } from "@/components/brand-logo";
import { AskBox } from "@/components/landing/ask-box";
import { AlertChip, FeatureFrame, InvestigationArt, LiveChip, PromptChip, Shot } from "@/components/landing/feature-art";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/primitives/accordion";
import { cn } from "@/lib/utils";
import { AsciiBlob } from "@/components/landing/ascii-blob";

/** PostHog's logo, used only to refer to PostHog (connect / migrate). File: public/integrations/posthog.png */
function PostHogLogo({ size = 20, className }: { size?: number; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/integrations/posthog.png" alt="PostHog" height={size} className={className} style={{ height: size, width: "auto" }} />;
}

export const metadata = { title: { absolute: "hostpog — Ask anything about your product" } };

function Pill({ icon: Icon, children, tone = "light" }: { icon?: typeof Sparkles; children: ReactNode; tone?: "light" | "glass" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12px] font-medium",
        tone === "glass" ? "border border-white/40 bg-white/20 text-white backdrop-blur-md" : "border border-[#ffd9bd] bg-[#fff1e6] text-[#e2620f] dark:border-[#4a2a12] dark:bg-[#2a1709] dark:text-[#ff9a52]",
      )}
    >
      {Icon && <Icon size={13} aria-hidden />}
      {children}
    </span>
  );
}

function SectionTitle({ pill, icon, title, muted, sub }: { pill: string; icon?: typeof Sparkles; title: string; muted: string; sub?: string }) {
  return (
    <div className="mx-auto max-w-[720px] text-center">
      <Pill icon={icon}>{pill}</Pill>
      <h2 className="mt-5 text-[34px] font-semibold leading-[1.08] tracking-[-0.03em] text-ink sm:text-[46px]">
        {title}
        <br />
        <span className="text-ink-3">{muted}</span>
      </h2>
      {sub && <p className="mx-auto mt-5 max-w-[520px] text-[15px] leading-6 text-ink-3">{sub}</p>}
    </div>
  );
}

function FeatureRow({ label, title, body, art, reverse }: { label: string; title: ReactNode; body: string; art: ReactNode; reverse?: boolean }) {
  return (
    <div className={cn("grid items-center gap-12 md:grid-cols-[1.15fr_1fr] md:gap-16", reverse && "md:grid-cols-[1fr_1.15fr]")}>
      <div className={cn("min-w-0", reverse && "md:order-2")}>{art}</div>
      <div className={cn("min-w-0 pt-6 md:pt-0", reverse && "md:order-1")}>
        <p className="text-[13px] font-medium text-[#e2620f] dark:text-[#ff9a52]">{label}</p>
        <h3 className="mt-3 text-[30px] font-semibold leading-[1.1] tracking-[-0.025em] sm:text-[38px]">{title}</h3>
        <p className="mt-4 max-w-[400px] text-[15px] leading-6 text-ink-3">{body}</p>
      </div>
    </div>
  );
}

const SUITE = [
  { icon: ToggleRight, title: "Feature flags", body: "Percentage rollouts, targeting by person properties, variants and payloads. Same bucketing as PostHog, so users keep their variant when you switch." },
  { icon: FlaskConical, title: "Experiments", body: "Split traffic with a flag, pick the goal event, and get a plain answer: which variant wins and how sure we are." },
  { icon: MessageSquareText, title: "Surveys", body: "NPS, ratings and open questions, shown by the posthog-js widget you already ship." },
  { icon: BrainCircuit, title: "LLM analytics", body: "Cost, tokens, latency and errors per model and per user. PostHog's AI wrappers work unchanged." },
  { icon: ScrollText, title: "Logs", body: "Send OpenTelemetry logs and jump from an error line to the user who hit it." },
  { icon: Workflow, title: "Workflows", body: "When an event happens, post to Slack or call your webhook. Retries included." },
];

const WHY = [
  { icon: Server, title: "Runs on your servers", body: "Postgres, ClickHouse and Redis in one Docker Compose file." },
  { icon: KeyRound, title: "Bring your own model", body: "Use OpenAI, Anthropic, Gemini or a local model, with spend limits you set." },
  { icon: Lock, title: "Private by default", body: "Secrets encrypted at rest. Models see aggregates, not raw events." },
];

const BEFORE = [
  "Dashboards nobody reads, and a backlog of “can you pull this?” requests",
  "Days of digging to find out why a metric dropped",
  "Your users' data sitting on someone else's servers",
  "A bill that grows with every event you track",
]
const AFTER = [
  "Ask a question, get the chart and the reason behind it",
  "Investigations that show the query behind every number",
  "Events stored in your own ClickHouse",
  "Free and open source — run it anywhere",
]

const FAQ: { icon: typeof Sparkles; q: string; a: ReactNode }[] = [
  { icon: HelpCircle, q: "What is hostpog?", a: "An open-source alternative to PostHog: product and web analytics, feature flags, experiments, surveys, LLM analytics, logs and workflows, with an AI assistant that can answer questions and set things up." },
  { icon: Layers, q: "How is it different from PostHog?", a: "hostpog focuses on answering product questions quickly and runs entirely on your own stack. It can sit on top of an existing PostHog project, or replace it with its own SDKs and storage." },
  { icon: Sparkles, q: "Is it free?", a: "Yes. hostpog is MIT licensed. You pay only for the servers you run it on and for any AI provider you connect." },
  { icon: Lock, q: "Where does my data go?", a: "Nowhere you don't send it. Native events land in your ClickHouse, PostHog connections are read-only, and AI calls go straight to the provider you configure." },
  { icon: Bot, q: "Which AI models can I use?", a: "Any OpenAI, Anthropic, Gemini or OpenRouter model, and any OpenAI-compatible endpoint — including local models like Ollama." },
  { icon: Repeat, q: "Can I move off PostHog?", a: "Yes. Import a PostHog batch export, reconcile the numbers, then switch your SDK over when you're ready." },
];

export default function Landing() {
  return (
    <main className="bg-[#f4f4f5] dark:bg-canvas">
      {/* Hero */}
      <section className="relative overflow-hidden rounded-b-[36px] bg-[#8fb6d4] sm:rounded-b-[48px]">
        <Image src="/landing/sky.webp" alt="" fill loading="eager" fetchPriority="high" sizes="100vw" className="object-cover object-bottom" />
        <div aria-hidden className="dot-grid absolute inset-0 opacity-40" />
        <div className="relative px-5 pt-32 text-center sm:pt-36">
          <div className="fade-up">
            <Link href="/#migrate" className="inline-flex items-center gap-2 rounded-full border border-white/40 bg-white/20 py-1 pl-1 pr-3 text-[13px] font-medium text-white backdrop-blur-md transition hover:bg-white/30">
              <span className="flex h-6 items-center justify-center rounded-full bg-white px-2">
                <PostHogLogo size={12} />
              </span>
              Say bye to PostHog <span aria-hidden>👋</span>
              <span className="text-white/70">→</span>
            </Link>
          </div>
          <h1 className="fade-up mx-auto mt-6 max-w-[920px] text-balance text-[31px] font-semibold leading-[1.12] tracking-[-0.035em] text-white [text-shadow:0_2px_24px_rgb(30_60_90/0.25)] sm:text-[58px]" style={{ animationDelay: "60ms" }}>
            Self-hosted product analytics,
            <br />
            with an{" "}
            <span className="relative -top-1 mx-0.5 inline-flex size-[40px] items-center justify-center rounded-[12px] bg-gradient-to-b from-[#ffa261] to-[#f26a12] align-middle text-white shadow-[0_10px_24px_-8px_rgb(242_106_18/0.8),inset_0_1px_0_rgb(255_255_255/0.35)] sm:size-[58px] sm:rounded-[16px]">
              <Mark size={30} mono />
            </span>{" "}
            AI analyst built in
          </h1>
          <p className="fade-up mx-auto mt-6 max-w-[600px] text-balance text-[16px] leading-7 text-white/90 [text-shadow:0_1px_12px_rgb(30_60_90/0.25)] sm:text-[18px]" style={{ animationDelay: "100ms" }}>
            Trends, funnels, retention and web analytics on your own servers — and answers in plain English when a number moves.
          </p>
          <div className="fade-up mt-10" style={{ animationDelay: "140ms" }}>
            <AskBox />
          </div>
          <div className="fade-up mt-8 flex flex-wrap items-center justify-center gap-3" style={{ animationDelay: "200ms" }}>
            <Link href="/signup" className="inline-flex h-11 items-center whitespace-nowrap rounded-xl bg-gradient-to-b from-[#ff8a3d] to-[#f26a12] px-5 text-[15px] font-medium text-white shadow-[0_8px_20px_-8px_rgb(242_106_18/0.8),inset_0_1px_0_rgb(255_255_255/0.25)] transition hover:brightness-105">
              Get started free
            </Link>
            <Link href="/docs/self-host" className="inline-flex h-11 items-center whitespace-nowrap rounded-xl bg-white px-5 text-[15px] font-medium text-zinc-900 shadow-sm transition hover:bg-zinc-50">
              Self-host in 5 minutes
            </Link>
          </div>
        </div>

        {/* Product mockup with mountains in front */}
        <div className="relative mx-auto mt-16 h-[320px] max-w-[1080px] px-4 sm:h-[640px]">
          <div className="overflow-hidden rounded-t-[18px] border border-white/60 bg-white/70 p-2 pb-0 shadow-[0_30px_80px_-30px_rgb(20_40_60/0.6)] backdrop-blur-md">
            <div className="flex items-center gap-3 px-2 pb-2 pt-0.5">
              <div className="flex gap-1.5">
                <span className="size-2.5 rounded-full bg-[#ff5f57]" />
                <span className="size-2.5 rounded-full bg-[#febc2e]" />
                <span className="size-2.5 rounded-full bg-[#28c840]" />
              </div>
              <div className="mx-auto flex h-6 w-full max-w-[360px] items-center justify-center gap-1.5 rounded-lg bg-zinc-100/90 text-[11px] text-zinc-500">
                <Lock size={10} /> app.hostpog.dev
              </div>
              <span className="w-[42px]" />
            </div>
            <div className="relative overflow-hidden rounded-t-[10px] border border-zinc-200/80 bg-white">
              <Image src="/landing/app-overview.png" alt="hostpog overview dashboard with user metrics, an activity chart and top events" width={2880} height={1800} loading="eager" className="h-auto w-full" />
            </div>
          </div>
        </div>
        <Image src="/landing/mountains.webp" alt="" width={2400} height={1066} aria-hidden className="pointer-events-none absolute -bottom-[4%] left-1/2 h-auto w-full min-w-[900px] -translate-x-1/2 select-none sm:-bottom-[12%]" />
      </section>

      {/* Works with */}
      <section className="px-5 pt-14 md:px-8">
        <p className="text-center text-[13px] text-ink-3">Works with the tools you already use</p>
        <ul className="mx-auto mt-5 flex max-w-[900px] flex-wrap items-center justify-center gap-x-10 gap-y-3 text-[17px] font-semibold tracking-tight text-ink-3/80">
          <li className="flex items-center gap-2 text-ink-2">
            <PostHogLogo size={18} />
            PostHog
          </li>
          {[
            ["openai", "OpenAI"],
            ["claude", "Claude"],
            ["gemini", "Gemini"],
            ["openrouter", "OpenRouter"],
            ["ollama", "Ollama"],
          ].map(([id, n]) => (
            <li key={id} className="flex items-center gap-2">
              <BrandLogo id={id!} size={18} className="opacity-90" />
              {n}
            </li>
          ))}
        </ul>
      </section>

      {/* Platform */}
      <section id="platform" className="relative scroll-mt-20 px-5 pt-28 pb-10 md:px-8">
        <div aria-hidden className="dot-grid-ink absolute inset-0 dark:opacity-0" />
        <div className="relative">
          <SectionTitle
            pill="Platform"
            icon={Layers}
            title="One question box."
            muted="Your whole product behind it."
            sub="Analytics, an AI analyst, flags, experiments, surveys, LLM analytics, logs and workflows. One place, one SDK."
          />
          <div className="mx-auto mt-24 max-w-[1100px] space-y-32">
            <FeatureRow
              label="Investigations"
              title={
                <>
                  Ask why,
                  <br />
                  not just what.
                </>
              }
              body="Describe what moved. hostpog compares periods, separates traffic from conversion, segments by browser, release or plan — and shows the query behind every number."
              art={
                <FeatureFrame float={<PromptChip>Why did trial signups drop last week?</PromptChip>}>
                  <InvestigationArt />
                </FeatureFrame>
              }
            />
            <FeatureRow
              reverse
              label="Funnels"
              title={
                <>
                  Find the drop-off
                  <br />
                  in seconds.
                </>
              }
              body="Build a funnel by naming the steps. Break it down by any property and click through to the people who didn't make it."
              art={
                <FeatureFrame side="right" float={<AlertChip />}>
                  <Shot src="/landing/funnel.png" alt="Funnel broken down by browser" />
                </FeatureFrame>
              }
            />
            <FeatureRow
              label="Web analytics"
              title={
                <>
                  Every visit,
                  <br />
                  as it happens.
                </>
              }
              body="Visitors, sessions, bounce rate, top pages, referrers and UTM campaigns — without a separate tool or a cookie banner of its own."
              art={
                <FeatureFrame float={<LiveChip />}>
                  <Shot src="/landing/web.png" alt="Web analytics dashboard" />
                </FeatureFrame>
              }
            />
          </div>
          <div className="mx-auto mt-32 max-w-[1100px]">
            <h3 className="text-center text-[28px] font-semibold tracking-[-0.03em]">And the rest of the toolkit</h3>
            <p className="mx-auto mt-3 max-w-[520px] text-center text-[15px] leading-6 text-ink-3">The assistant can set any of these up for you. Ask for a flag at 20% or an NPS survey and review it before it goes live.</p>
            <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {SUITE.map((f) => (
                <div key={f.title} className="rounded-2xl border border-line bg-white/80 p-5 shadow-card">
                  <f.icon size={20} className="text-[#e2620f]" aria-hidden />
                  <p className="mt-4 text-[15px] font-medium">{f.title}</p>
                  <p className="mt-1.5 text-[13px] leading-5 text-ink-3">{f.body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Say bye to PostHog */}
      <section id="migrate" className="scroll-mt-20 px-5 pt-32 md:px-8">
        <div className="relative mx-auto max-w-[1100px] overflow-hidden rounded-[36px] border border-[#ffd9bd] bg-gradient-to-br from-white via-[#fff8f2] to-[#ffeede] px-6 py-16 text-ink shadow-[0_30px_60px_-40px_rgb(242_106_18/0.5)] sm:px-14">
          <div aria-hidden className="absolute -right-24 -top-24 size-[420px] rounded-full bg-[#f26a12]/15 blur-[100px]" />
          <div aria-hidden className="absolute -bottom-32 -left-20 size-[360px] rounded-full bg-[#1d4aff]/10 blur-[100px]" />
          <div className="relative grid items-center gap-12 md:grid-cols-[1fr_1fr]">
            <div>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-[#ffd9bd] bg-[#fff1e6] px-3 py-1 text-[12px] font-medium text-[#e2620f]">
                <Repeat size={13} aria-hidden /> Migrate
              </span>
              <h2 className="mt-5 text-[36px] font-semibold leading-[1.05] tracking-[-0.035em] sm:text-[46px]">
                Say bye to PostHog.
                <br />
                <span className="text-ink-3">Keep every event.</span>
              </h2>
              <p className="mt-5 max-w-[420px] text-[15px] leading-6 text-ink-3">Bring your history over, check the numbers match, and switch your SDK when you&apos;re ready. Your PostHog keeps running until you cut over.</p>
              <Link href="/signup" className="mt-8 inline-flex h-11 items-center whitespace-nowrap rounded-xl bg-gradient-to-b from-[#ff8a3d] to-[#f26a12] px-5 text-[15px] font-medium text-white shadow-[0_8px_20px_-8px_rgb(242_106_18/0.8),inset_0_1px_0_rgb(255_255_255/0.25)] hover:brightness-105">
                Start migrating
              </Link>
            </div>
            <div>
              <div className="flex items-center justify-center gap-5">
                <span className="flex size-20 items-center justify-center rounded-3xl border border-line bg-white shadow-[0_20px_40px_-20px_rgb(0_0_0/0.25)]">
                  <PostHogLogo size={30} />
                </span>
                <span className="flex items-center gap-1.5 text-ink-3/50" aria-hidden>
                  <span className="size-1.5 rounded-full bg-current" />
                  <span className="size-1.5 rounded-full bg-current" />
                  <span className="size-1.5 rounded-full bg-[#f26a12]" />
                  <ArrowRight size={18} className="text-[#f26a12]" />
                </span>
                <span className="flex size-20 items-center justify-center rounded-3xl bg-gradient-to-b from-[#ffa261] to-[#f26a12] text-white shadow-[0_20px_40px_-12px_rgb(242_106_18/0.7)]">
                  <Mark size={44} mono />
                </span>
              </div>
              <ol className="mt-10 space-y-3">
                {[
                  ["Connect", "Point hostpog at your PostHog project, read-only."],
                  ["Import", "Pull in your history from a batch export and reconcile counts."],
                  ["Switch", "Change one line in your SDK config. Done."],
                ].map(([t, b], i) => (
                  <li key={t} className="flex items-start gap-4 rounded-2xl border border-line bg-white/80 p-4 shadow-card">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-[#fff1e6] text-[12px] font-semibold text-[#e2620f]">{i + 1}</span>
                    <div>
                      <p className="text-[14px] font-medium">{t}</p>
                      <p className="text-[13px] text-ink-3">{b}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </section>

      {/* Before / after */}
      <section className="px-5 pt-32 md:px-8">
        <SectionTitle pill="Why hostpog" icon={Code2} title="Less dashboard digging." muted="More answers." />
        <div className="mx-auto mt-14 grid max-w-[960px] gap-4 md:grid-cols-2">
          <div className="rounded-3xl border border-line bg-panel/60 p-7">
            <p className="text-[15px] font-semibold text-ink-3">Without hostpog</p>
            <ul className="mt-5 space-y-3.5">
              {BEFORE.map((t) => (
                <li key={t} className="flex gap-3 text-[14px] leading-6 text-ink-3">
                  <XCircle size={18} className="mt-0.5 shrink-0 text-ink-3/60" aria-hidden />
                  {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-3xl border border-[#ffd9bd] bg-panel p-7 shadow-[0_20px_50px_-30px_rgb(242_106_18/0.45)] dark:border-[#4a2a12]">
            <p className="flex items-center gap-2 text-[15px] font-semibold">
              <Mark size={18} /> With hostpog
            </p>
            <ul className="mt-5 space-y-3.5">
              {AFTER.map((t) => (
                <li key={t} className="flex gap-3 text-[14px] leading-6">
                  <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-[#f26a12]" aria-hidden />
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </div>
        <div className="mx-auto mt-4 grid max-w-[960px] gap-4 md:grid-cols-3">
          {WHY.map((w) => (
            <div key={w.title} className="rounded-3xl border border-line bg-panel p-6 shadow-card">
              <span className="flex size-9 items-center justify-center rounded-xl bg-[#fff1e6] text-[#e2620f] dark:bg-[#2a1709] dark:text-[#ff9a52]">
                <w.icon size={17} />
              </span>
              <p className="mt-5 text-[16px] font-semibold tracking-tight">{w.title}</p>
              <p className="mt-1.5 text-[14px] leading-6 text-ink-3">{w.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="scroll-mt-20 px-5 pt-32 pb-32 md:px-8">
        <SectionTitle pill="FAQs" icon={HelpCircle} title="You've got questions?" muted="We've got answers." />
        <Accordion type="multiple" className="mx-auto mt-14 grid max-w-[900px] items-start gap-3 md:grid-cols-2">
          {[0, 1].map((col) => (
            <div key={col} className="space-y-3">
              {FAQ.filter((_, i) => i % 2 === col).map((f) => (
                <AccordionItem key={f.q} value={f.q}>
                  <AccordionTrigger>
                    <span className="flex items-center gap-2.5">
                      <f.icon size={15} className="text-ink-3" aria-hidden />
                      {f.q}
                    </span>
                  </AccordionTrigger>
                  <AccordionContent className="pl-[42px]">{f.a}</AccordionContent>
                </AccordionItem>
              ))}
            </div>
          ))}
        </Accordion>
        <div className="relative mx-auto mt-24 flex max-w-[1100px] flex-col items-center gap-6 overflow-hidden rounded-[32px] bg-gradient-to-br from-[#ff8a3d] via-[#f86a24] to-[#ee4f1c] px-6 py-14 text-center text-white shadow-[0_30px_60px_-30px_rgb(242_106_18/0.6)]">
          <AsciiBlob className="pointer-events-none absolute inset-0 h-full w-full" />
          <div aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgb(170_50_0/0.22),transparent_65%)]" />
          <h2 className="relative text-[30px] font-semibold leading-tight tracking-[-0.03em] [text-shadow:0_2px_16px_rgb(140_40_0/0.45)] sm:text-[40px]">Move off PostHog in five minutes.</h2>
          <p className="relative max-w-[600px] text-[15px] text-white [text-shadow:0_1px_10px_rgb(140_40_0/0.55)]">Connect read-only, change one line, switch off. Free forever on your own servers.</p>
          <div className="relative flex flex-wrap justify-center gap-3">
            <Link href="/signup" className="inline-flex h-11 items-center rounded-xl bg-white px-5 text-[15px] font-medium text-zinc-900 shadow-sm hover:bg-zinc-50">
              Migrate from PostHog
            </Link>
            <Link href="/docs/self-host" className="inline-flex h-11 items-center rounded-xl border border-white/40 px-5 text-[15px] font-medium text-white hover:bg-white/10">
              Self-hosting guide
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}
