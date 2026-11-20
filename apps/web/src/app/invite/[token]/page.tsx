import { Users } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Wordmark } from "@/components/brand";
import { buttonVariants } from "@/components/primitives/button";
import { getSessionUser } from "@/server/authz";
import { HttpError } from "@/server/http";
import { acceptInvite, lookupInvite } from "@/server/invites";
import { JoinButton, SignOutLink } from "./join";

export const dynamic = "force-dynamic";
export const metadata = { title: "Join your team", robots: { index: false } };

const REASONS = {
  not_found: "This invite link isn't valid. It may have been revoked.",
  expired: "This invite link has expired.",
  used: "This invite link was already used.",
} as const;

export default async function Invite({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ join?: string }> }) {
  const { token } = await params;
  const { join } = await searchParams;
  const inv = await lookupInvite(token);
  const user = await getSessionUser();

  let error: string | null = null;
  // coming back from sign-up / sign-in through this invite: join without another click
  if (inv.ok && user && join === "1") {
    let target: string | null = null;
    try {
      const r = await acceptInvite(token, user, null);
      target = r.projectId ? `/app/p/${r.projectId}/overview` : "/app";
    } catch (e) {
      error = e instanceof HttpError ? e.message : "Couldn't join. Try again.";
    }
    if (target) redirect(target);
  }

  const back = encodeURIComponent(`/invite/${token}?join=1`);
  return (
    <main className="flex min-h-screen flex-col px-6 py-8 sm:px-10">
      <Wordmark />
      <div className="mx-auto flex w-full max-w-[420px] flex-1 flex-col justify-center py-12">
        {!inv.ok ? (
          <>
            <h1 className="text-[24px] font-semibold tracking-[-0.02em]">Invite not available</h1>
            <p className="mt-2 text-[14px] text-ink-2">{REASONS[inv.reason]} Ask a workspace admin for a new link.</p>
            <Link href={user ? "/app" : "/login"} className={`${buttonVariants({ variant: "secondary" })} mt-6 self-start`}>
              {user ? "Go to HostPog" : "Sign in"}
            </Link>
          </>
        ) : (
          <>
            <span className="inline-flex size-11 items-center justify-center rounded-xl bg-brand-soft text-brand-deep">
              <Users size={20} />
            </span>
            <h1 className="mt-5 text-[24px] font-semibold tracking-[-0.02em]">Join {inv.workspaceName}</h1>
            <p className="mt-2 text-[14px] text-ink-2">
              {inv.inviter ? `${inv.inviter} invited you` : "You've been invited"} to {inv.workspaceName} on HostPog as {inv.role === "admin" ? "an admin" : `a ${inv.role}`}. You&apos;ll see the
              team&apos;s data, dashboards and AI setup right away. Nothing to set up.
            </p>
            {error && <p className="mt-4 rounded-lg border border-neg/30 px-3 py-2 text-[13px] text-neg">{error}</p>}
            {user ? (
              <div className="mt-7 space-y-3">
                <JoinButton token={token} workspaceName={inv.workspaceName} />
                <p className="text-[12px] text-ink-3">
                  Signed in as {user.email}. <SignOutLink next={`/invite/${token}`} />
                </p>
              </div>
            ) : (
              <div className="mt-7 flex flex-col gap-2.5">
                <Link href={`/signup?invite=${token}&next=${back}`} className={buttonVariants({ variant: "default" })}>
                  Create an account and join
                </Link>
                <Link href={`/login?invite=${token}&next=${back}`} className={buttonVariants({ variant: "secondary" })}>
                  I already have an account
                </Link>
                {inv.email && <p className="text-[12px] text-ink-3">This invite is for {inv.email}.</p>}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}
