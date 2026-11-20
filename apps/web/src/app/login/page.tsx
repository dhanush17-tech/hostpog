import { Suspense } from "react";
import { AuthForm } from "@/components/auth-form";
import { lookupInvite } from "@/server/invites";

export const metadata = { title: "Sign in" };

export default async function Login({ searchParams }: { searchParams: Promise<{ invite?: string }> }) {
  const { invite } = await searchParams;
  const inv = invite ? await lookupInvite(invite) : null;
  return (
    <Suspense>
      <AuthForm mode="login" invite={inv?.ok ? { token: invite!, workspaceName: inv.workspaceName, inviter: inv.inviter, email: inv.email } : null} />
    </Suspense>
  );
}
