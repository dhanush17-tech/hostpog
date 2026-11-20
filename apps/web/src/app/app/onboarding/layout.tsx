import { redirect } from "next/navigation";
import { Suspense, type ReactNode } from "react";
import { Wordmark } from "@/components/brand";
import { ThemeToggle } from "@/components/theme";
import { getSessionUser } from "@/server/authz";

export const dynamic = "force-dynamic";

export default async function OnboardingLayout({ children }: { children: ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login?next=/app");
  return (
    <div className="min-h-screen">
      <header className="flex h-16 items-center justify-between px-4 md:px-8">
        <Wordmark href="/app" />
        <ThemeToggle />
      </header>
      <main className="mx-auto max-w-[640px] px-4 py-12 md:px-8">
        <Suspense>{children}</Suspense>
      </main>
    </div>
  );
}
