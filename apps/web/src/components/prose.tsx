import Link from "next/link";
import type { ReactNode } from "react";

const DOCS = [
  ["/docs", "Overview"],
  ["/docs/self-host", "Self-hosting"],
  ["/docs/posthog", "Connecting PostHog"],
  ["/docs/sdk", "SDKs"],
  ["/privacy", "Privacy & data flow"],
  ["/oss", "Open source & roadmap"],
] as const;

export function DocPage({ title, lead, children }: { title: string; lead?: string; children: ReactNode }) {
  return (
    <main className="mx-auto grid max-w-[1100px] gap-10 px-5 pt-28 pb-24 md:grid-cols-[200px_1fr] md:px-8">
      <nav aria-label="Documentation" className="text-[13px]">
        <ul className="space-y-1 md:sticky md:top-6">
          {DOCS.map(([href, label]) => (
            <li key={href}>
              <Link href={href} className="text-ink-2 hover:text-ink">
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      <article className="doc max-w-[720px] text-[15px] leading-7 text-ink-2 [&_code]:rounded [&_code]:bg-panel-2 [&_code]:px-1 [&_code]:font-mono [&_code]:text-[13px] [&_h2]:mt-10 [&_h2]:text-[20px] [&_h2]:font-semibold [&_h2]:text-ink [&_h3]:mt-6 [&_h3]:font-semibold [&_h3]:text-ink [&_li]:mt-1 [&_ol]:list-decimal [&_ol]:pl-6 [&_p]:mt-3 [&_pre]:mt-3 [&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:border [&_pre]:border-line [&_pre]:bg-panel [&_pre]:p-3 [&_pre]:text-[12px] [&_pre]:leading-6 [&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_table]:mt-3 [&_table]:w-full [&_table]:text-[13px] [&_td]:border-b [&_td]:border-line [&_td]:py-1.5 [&_td]:pr-3 [&_th]:border-b [&_th]:border-line [&_th]:py-1.5 [&_th]:text-left [&_th]:text-ink [&_ul]:list-disc [&_ul]:pl-6 [&_a]:text-brand-deep [&_a]:underline">
        <h1 className="text-[32px] font-semibold tracking-tight text-ink">{title}</h1>
        {lead && <p className="!mt-2 text-[17px] text-ink-2">{lead}</p>}
        {children}
      </article>
    </main>
  );
}
