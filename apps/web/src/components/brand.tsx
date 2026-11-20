import Link from "next/link";

/**
 * HostPog mark: two offset rounded squares — a host and its shadow copy —
 * with the DevLabs orange as a single accent. Original artwork (MIT).
 * `mono` renders it for use on an orange tile.
 */
export function Mark({ size = 20, mono = false }: { size?: number; mono?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden focusable="false">
      <rect x="2.5" y="2.5" width="13" height="13" rx="3" fill="none" stroke="currentColor" strokeWidth="2" />
      <rect x="8.5" y="8.5" width="13" height="13" rx="3" fill={mono ? "currentColor" : "var(--brand)"} />
      <rect x="8.5" y="8.5" width="7" height="7" rx="1.5" fill={mono ? "#f26a12" : "currentColor"} opacity={mono ? 1 : 0.9} />
    </svg>
  );
}

export function Wordmark({ href = "/" }: { href?: string; attribution?: boolean }) {
  return (
    <Link href={href} className="group inline-flex items-center gap-2 text-ink" aria-label="HostPog home">
      <Mark size={22} />
      <span className="text-[16px] font-semibold tracking-tight">hostpog</span>
    </Link>
  );
}
