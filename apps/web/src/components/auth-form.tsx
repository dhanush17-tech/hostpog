"use client";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";
import { savePendingQuestion } from "@/lib/pending-question";
import { Wordmark } from "./brand";
import { Button, ErrorBox, Field, Input } from "./ui";

export interface InviteInfo {
  token: string;
  workspaceName: string;
  inviter: string | null;
  email: string | null;
}

export function AuthForm({ mode, invite }: { mode: "login" | "signup"; invite?: InviteInfo | null }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [name, setName] = useState("");
  const [email, setEmail] = useState(invite?.email ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const next = sp.get("next");
  const question = sp.get("q");
  useEffect(() => savePendingQuestion(question), [question]);
  // only same-site paths: the app, or back to the invite being accepted
  const safeNext = next && (next.startsWith("/app") || next.startsWith("/invite/")) && !next.startsWith("//") ? next : invite ? `/invite/${invite.token}?join=1` : "/app";
  const other = (path: string) => (invite ? `${path}?invite=${invite.token}&next=${encodeURIComponent(safeNext)}` : question ? `${path}?q=${encodeURIComponent(question)}` : path);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const res =
      mode === "signup"
        ? await authClient.signUp.email({ name: name.trim() || email.split("@")[0]!, email: email.trim(), password })
        : await authClient.signIn.email({ email: email.trim(), password });
    setLoading(false);
    if (res.error) {
      const fallback =
        mode === "signup" ? "We couldn't create your account. Nothing was saved — please try again in a moment." : "We couldn't sign you in. Check your email and password, then try again.";
      setError(res.error.status === 429 ? "Too many attempts. Wait a minute and try again." : res.error.status && res.error.status >= 500 ? fallback : (res.error.message ?? fallback));
      return;
    }
    router.push(safeNext);
    router.refresh();
  };

  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_1.1fr]">
      <div className="flex flex-col px-6 py-8 sm:px-10">
        <Wordmark />
        <div className="mx-auto flex w-full max-w-[360px] flex-1 flex-col justify-center py-12">
          <h1 className="text-[26px] font-semibold tracking-[-0.02em]">{invite ? `Join ${invite.workspaceName}` : mode === "signup" ? "Create your account" : "Welcome back"}</h1>
          <p className="mt-1.5 text-[14px] text-ink-3">
            {invite
              ? `${invite.inviter ? `${invite.inviter} invited you. ` : ""}${mode === "signup" ? "Create your account" : "Sign in"} and you'll land in the team's project.`
              : mode === "signup"
                ? "Get answers from your product data in minutes."
                : "Sign in to your hostpog workspace."}
          </p>
          {question && (
            <div className="mt-5 rounded-xl border border-line bg-panel px-3.5 py-3 text-[13px] shadow-card">
              <p className="text-ink-3">We&apos;ll answer this once your data is connected:</p>
              <p className="mt-0.5 font-medium">“{question}”</p>
            </div>
          )}
          <form onSubmit={submit} className="mt-8 space-y-4" noValidate>
            {mode === "signup" && <Field label="Name">{(id) => <Input id={id} className="h-10" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />}</Field>}
            <Field label="Email">{(id) => <Input id={id} className="h-10" type="email" autoComplete="email" placeholder="you@company.com" required value={email} onChange={(e) => setEmail(e.target.value)} />}</Field>
            <Field label="Password" hint={mode === "signup" ? "At least 10 characters." : undefined}>
              {(id) => (
                <Input id={id} className="h-10" type="password" autoComplete={mode === "signup" ? "new-password" : "current-password"} required minLength={10} value={password} onChange={(e) => setPassword(e.target.value)} />
              )}
            </Field>
            {error && <ErrorBox error={error} />}
            <Button type="submit" variant="primary" className="h-10 w-full text-[14px]" loading={loading}>
              {mode === "signup" ? "Create account" : "Sign in"}
            </Button>
          </form>
          <p className="mt-6 text-[13px] text-ink-3">
            {mode === "signup" ? (
              <>
                Already have an account?{" "}
                <Link className="font-medium text-ink underline-offset-2 hover:underline" href={other("/login")}>
                  Sign in
                </Link>
              </>
            ) : (
              <>
                New to hostpog?{" "}
                <Link className="font-medium text-ink underline-offset-2 hover:underline" href={other("/signup")}>
                  Create an account
                </Link>
              </>
            )}
          </p>
        </div>
        <p className="text-[12px] text-ink-3">© DevLabs · Open source, MIT licensed</p>
      </div>
      <div className="relative hidden overflow-hidden lg:m-3 lg:block lg:rounded-[28px]">
        <Image src="/landing/sky.webp" alt="" fill loading="eager" fetchPriority="high" sizes="50vw" className="object-cover object-bottom" />
        <div className="relative flex h-full flex-col justify-between p-12">
          <p className="max-w-[420px] text-[30px] font-semibold leading-[1.15] tracking-[-0.03em] text-white [text-shadow:0_2px_20px_rgb(30_60_90/0.25)]">Ask anything about your product. Get answers with the numbers to back them.</p>
          <div className="-mr-24 overflow-hidden rounded-tl-2xl rounded-bl-2xl border border-white/60 bg-white/70 p-1.5 shadow-2xl backdrop-blur">
            <Image src="/landing/app-overview.png" alt="" width={2880} height={1800} loading="eager" className="h-auto w-full rounded-xl" />
          </div>
        </div>
      </div>
    </div>
  );
}
