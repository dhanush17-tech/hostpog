import Link from "next/link";
import { Mark } from "@/components/brand";

const COLS = [
  { title: "Product", links: [["/#platform", "Platform"], ["/docs/posthog", "Connect PostHog"], ["/docs/sdk", "SDKs"], ["/signup", "Get started"]] },
  { title: "Resources", links: [["/docs", "Documentation"], ["/docs/self-host", "Self-hosting"], ["/oss", "Open source"]] },
  { title: "Legal", links: [["/privacy", "Privacy"], ["/oss", "MIT License"]] },
] as const;

export function SiteFooter({ repo }: { repo?: string }) {
  return (
    <footer className="relative overflow-hidden bg-[#0c0c0d] text-white">
      <div className="mx-auto max-w-[1200px] px-5 pt-16 pb-10 md:px-8">
        <div className="grid gap-12 md:grid-cols-[1.4fr_1fr_1fr_1fr]">
          <div>
            <Link href="/" className="inline-flex items-center gap-2 text-white" aria-label="HostPog home">
              <Mark size={24} />
              <span className="text-[19px] font-semibold tracking-tight">hostpog</span>
            </Link>
            <p className="mt-4 max-w-[300px] text-[14px] leading-6 text-white/55">Open-source product analytics you run yourself. Built by DevLabs.</p>
            {repo && (
              <a href={repo} rel="noreferrer noopener" className="mt-5 inline-flex h-9 items-center gap-2 rounded-xl border border-white/15 px-3.5 text-[13px] text-white/80 hover:bg-white/5 hover:text-white">
                <svg viewBox="0 0 24 24" width="15" height="15" fill="currentColor" aria-hidden>
                  <path d="M12 .5a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2.1c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1.1-.7.1-.7.1-.7 1.2.1 1.9 1.3 1.9 1.3 1.1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.8-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2-.1-.3-.5-1.5.1-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 4.6 18.3 5 18.3 5c.7 1.7.2 2.9.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .5Z" />
                </svg>
                Star on GitHub
              </a>
            )}
          </div>
          {COLS.map((c) => (
            <div key={c.title}>
              <p className="text-[13px] font-medium text-white/40">{c.title}</p>
              <ul className="mt-4 space-y-2.5">
                {c.links.map(([href, label]) => (
                  <li key={label}>
                    <Link href={href} className="text-[14px] text-white/75 hover:text-white">
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="relative z-10 mt-16 flex flex-wrap items-center justify-between gap-4 border-t border-white/10 pt-6 text-[12px] text-white/40">
          <p>© {new Date().getFullYear()} DevLabs. MIT licensed.</p>
          <p>Not affiliated with PostHog Inc.</p>
        </div>
      </div>
      <p aria-hidden className="pointer-events-none absolute -bottom-[0.22em] right-0 select-none text-[22vw] font-bold leading-none tracking-[-0.06em] text-white/[0.035] md:text-[220px]">
        hostpog
      </p>
    </footer>
  );
}
