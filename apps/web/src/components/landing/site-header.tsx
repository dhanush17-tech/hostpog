"use client";
import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Mark } from "@/components/brand";
import { cn } from "@/lib/utils";

const LINKS = [
  { href: "/#platform", label: "Product" },
  { href: "/docs", label: "Docs" },
  { href: "/oss", label: "Open source" },
  { href: "/#faq", label: "FAQ" },
];

export function SiteHeader({ repo }: { repo?: string }) {
  const pathname = usePathname();
  const overlay = pathname === "/";
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 24);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  const light = overlay && !scrolled;
  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-50 transition-all duration-300",
        light ? "bg-transparent" : "border-b border-line/70 bg-canvas/80 backdrop-blur-xl",
      )}
    >
      <div className="mx-auto flex h-16 max-w-[1200px] items-center px-5 md:px-8">
        <Link href="/" className={cn("inline-flex items-center gap-2", light ? "text-white" : "text-ink")} aria-label="HostPog home">
          <Mark size={22} />
          <span className="text-[17px] font-semibold tracking-tight">hostpog</span>
        </Link>
        <nav aria-label="Main" className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-9 text-[14px] md:flex">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className={cn("transition-colors", light ? "text-white/85 hover:text-white" : "text-ink-2 hover:text-ink")}>
              {l.label}
            </Link>
          ))}
          {repo && (
            <a href={repo} rel="noreferrer noopener" className={cn("transition-colors", light ? "text-white/85 hover:text-white" : "text-ink-2 hover:text-ink")}>
              GitHub
            </a>
          )}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Link href="/login" className={cn("hidden h-9 items-center rounded-xl px-3 text-[14px] font-medium sm:inline-flex", light ? "text-white/90 hover:text-white" : "text-ink-2 hover:text-ink")}>
            Log in
          </Link>
          <Link
            href="/signup"
            className="inline-flex h-9 items-center rounded-xl bg-gradient-to-b from-[#ff8a3d] to-[#f26a12] px-4 text-[14px] font-medium text-white shadow-[0_6px_16px_-6px_rgb(242_106_18/0.7),inset_0_1px_0_rgb(255_255_255/0.25)] transition hover:brightness-105"
          >
            Get started
          </Link>
          <button className={cn("inline-flex size-9 items-center justify-center rounded-lg md:hidden", light ? "text-white" : "text-ink")} aria-label="Open menu" onClick={() => setOpen((x) => !x)}>
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>
      {open && (
        <nav aria-label="Mobile" className="border-t border-line bg-canvas px-5 py-3 md:hidden">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} onClick={() => setOpen(false)} className="block py-2 text-[15px] text-ink">
              {l.label}
            </Link>
          ))}
          <Link href="/login" onClick={() => setOpen(false)} className="block py-2 text-[15px] text-ink">
            Log in
          </Link>
        </nav>
      )}
    </header>
  );
}
