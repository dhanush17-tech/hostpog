"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui";
import { apiSend } from "@/lib/api";
import { authClient } from "@/lib/auth-client";

export function JoinButton({ token, workspaceName }: { token: string; workspaceName: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <>
      <Button
        variant="primary"
        className="w-full"
        loading={busy}
        onClick={async () => {
          setBusy(true);
          setErr(null);
          try {
            const r = await apiSend<{ projectId: string | null }>("/api/v1/invites/accept", "POST", { token });
            router.push(r.projectId ? `/app/p/${r.projectId}/overview` : "/app");
            router.refresh();
          } catch (e) {
            setErr((e as Error).message);
            setBusy(false);
          }
        }}
      >
        Join {workspaceName}
      </Button>
      {err && <p className="text-[13px] text-neg">{err}</p>}
    </>
  );
}

export function SignOutLink({ next }: { next: string }) {
  return (
    <button
      type="button"
      className="font-medium text-ink underline-offset-2 hover:underline"
      onClick={async () => {
        await authClient.signOut();
        window.location.href = next;
      }}
    >
      Use another account
    </button>
  );
}
