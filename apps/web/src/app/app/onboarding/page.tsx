import { ArrowRight, Code2, DatabaseZap, PlugZap } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { DemoButton } from "./demo-button";
import { IntegrationLogo } from "@/components/integration-logo";
import { PendingQuestionBanner } from "@/components/pending-question";
import { getSessionUser, listAccessible } from "@/server/authz";
import { ensurePersonalWorkspace } from "@/server/invites";

export const metadata = { title: "Where is your product data?" };

export default async function Onboarding({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const sp = await searchParams;
  let ws = await listAccessible(user.id);
  if (!ws.length) {
    await ensurePersonalWorkspace(user);
    ws = await listAccessible(user.id);
  }
  const projectId = ws.flatMap((w) => w.projects).find((p) => p.id === sp.project)?.id ?? ws[0]?.projects[0]?.id;
  if (!projectId) return <p>No project available.</p>;

  const choices = [
    {
      href: `/app/onboarding/posthog?project=${projectId}`,
      icon: PlugZap,
      logo: "posthog",
      title: "Connect to PostHog",
      tag: "Already on PostHog",
      body: "See your PostHog data here, then move off PostHog when you're ready.",
    },
    { href: `/app/onboarding/native?project=${projectId}`, icon: Code2, title: "Start collecting data", body: "Install our SDK in your app." },
    {
      href: `/app/onboarding/import?project=${projectId}`,
      icon: DatabaseZap,
      title: "Import historical data",
      body: "Bring an existing dataset into your own infrastructure.",
    },
  ];
  return (
    <div>
      <PendingQuestionBanner lead="Connect your data and we'll answer your question:" />
      <h1 className="text-[28px] font-semibold tracking-[-0.02em]">Where is your product data?</h1>
      <p className="mt-1.5 text-[14px] text-ink-3">Pick one to start. You can add more sources later.</p>
      <ul className="mt-8 space-y-3">
        {choices.map((c) => (
          <li key={c.title}>
            <Link href={c.href} className="group flex items-center gap-4 rounded-xl border border-line bg-panel px-5 py-4 shadow-card transition hover:border-line-strong hover:shadow-md">
              {"logo" in c && c.logo ? <IntegrationLogo id={c.logo} name="PostHog" size={36} /> : <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft"><c.icon size={18} className="text-brand-deep" aria-hidden /></span>}
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2 text-[15px] font-medium">
                  {c.title}
                  {c.tag && <span className="rounded-full bg-brand-soft px-2 py-px text-[11px] font-medium text-brand-deep">{c.tag}</span>}
                </p>
                <p className="text-[13px] text-ink-3">{c.body}</p>
              </div>
              <ArrowRight size={16} className="text-ink-3 group-hover:text-ink" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
      <div className="mt-6 flex flex-wrap items-center gap-3 text-[13px] text-ink-2">
        <span>Just looking?</span>
        <DemoButton projectId={projectId} />
      </div>
    </div>
  );
}
