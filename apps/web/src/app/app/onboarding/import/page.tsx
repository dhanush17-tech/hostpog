import Link from "next/link";

export const metadata = { title: "Import historical data" };

export default async function ImportPage({ searchParams }: { searchParams: Promise<{ project?: string }> }) {
  const { project } = await searchParams;
  return (
    <div>
      <Link href={`/app/onboarding?project=${project ?? ""}`} className="text-[13px] text-ink-3 hover:text-ink">
        ← Back
      </Link>
      <h1 className="mt-2 text-[28px] font-semibold tracking-tight">Import historical data</h1>
      <div className="mt-4 rounded-lg border border-line bg-panel p-5 text-[14px] leading-6 text-ink-2">
        <p className="font-medium text-ink">Not available in this version.</p>
        <p className="mt-2">
          Historical import is planned (Gate E in PLAN.md): a resumable job that reads a PostHog batch export you configure yourself (S3-compatible storage or Postgres), with a dry run, schema
          preview, checkpoints, idempotent ingestion by event UUID, daily-count reconciliation and a cutover checklist.
        </p>
        <p className="mt-2">Until then you can connect PostHog read-only, which needs no copy at all, or start collecting new data with the HostPog SDK.</p>
        <div className="mt-4 flex gap-3 text-[13px]">
          <Link className="text-brand-deep hover:underline" href={`/app/onboarding/posthog?project=${project ?? ""}`}>
            Connect PostHog instead
          </Link>
          <Link className="text-brand-deep hover:underline" href="/docs/posthog">
            Read the migration notes
          </Link>
        </div>
      </div>
    </div>
  );
}
