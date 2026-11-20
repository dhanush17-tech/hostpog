import { Suspense } from "react";
import { AuthForm } from "@/components/auth-form";
import { lookupInvite } from "@/server/invites";

export const metadata = { title: "Create account" };

export default async function Signup({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  const { invite } = await searchParams;
  const inv = invite ? await lookupInvite(invite) : null;
  return (
    <Suspense>
      <AuthForm mode="signup" invite={inv?.ok ? { token: invite!, workspaceName: inv.workspaceName, inviter: inv.inviter, email: inv.email } : null} />
    </Suspense>
  );
}
