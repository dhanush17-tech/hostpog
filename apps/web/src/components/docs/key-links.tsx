import { ExternalLink } from "lucide-react";
import type { ReactNode } from "react";
import { BrandLogo } from "@/components/brand-logo";

export interface KeyLink {
  name: string;
  what: string;
  href: string;
  cta: string;
  note?: string;
  logo?: ReactNode;
  logoId?: string;
}

/** Cards that open the exact page where each credential is created. */
export function KeyLinks({ items }: { items: KeyLink[] }) {
  return (
    <div className="not-prose mt-4 grid gap-3 sm:grid-cols-2">
      {items.map((k) => (
        <div key={k.name + k.href} className="flex flex-col rounded-xl border border-line bg-panel p-4 shadow-card">
          <p className="flex items-center gap-2 text-[14px] font-semibold text-ink">
            {k.logo ?? (k.logoId ? <BrandLogo id={k.logoId} size={16} /> : null)}
            {k.name}
          </p>
          <p className="mt-1 flex-1 text-[13px] leading-5 text-ink-3">{k.what}</p>
          {k.note && <p className="mt-1 text-[12px] text-ink-3">{k.note}</p>}
          <a
            href={k.href}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 inline-flex h-8 w-fit items-center gap-1.5 rounded-lg border border-line bg-panel px-3 text-[13px] font-medium !text-ink !no-underline shadow-card hover:bg-panel-2"
          >
            {k.cta} <ExternalLink size={13} aria-hidden />
          </a>
        </div>
      ))}
    </div>
  );
}
