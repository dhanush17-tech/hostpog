import type { ReactNode } from "react";
import { SiteAnalytics } from "@/components/landing/site-analytics";
import { SiteFooter } from "@/components/landing/site-footer";
import { SiteHeader } from "@/components/landing/site-header";

const REPO = process.env.NEXT_PUBLIC_HOSTPOG_REPO_URL; // hidden until a public repository exists

export default function MarketingLayout({ children }: { children: ReactNode }) {
  return (
    <div className="light min-h-screen bg-canvas text-ink [color-scheme:light]">
      <a href="#content" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[60] focus:rounded focus:bg-panel focus:px-3 focus:py-2">
        Skip to content
      </a>
      <SiteHeader repo={REPO} />
      <div id="content">{children}</div>
      <SiteFooter repo={REPO} />
      <SiteAnalytics />
    </div>
  );
}
