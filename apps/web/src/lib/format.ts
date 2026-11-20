export const fmtInt = (n: number | null | undefined) => (n === null || n === undefined ? "—" : Math.round(n).toLocaleString("en-US"));

export const fmtNum = (n: number | null | undefined, digits = 1) =>
  n === null || n === undefined ? "—" : n.toLocaleString("en-US", { maximumFractionDigits: digits });

export const fmtPct = (n: number | null | undefined, digits = 1) => (n === null || n === undefined || !Number.isFinite(n) ? "—" : `${(n * 100).toFixed(digits)}%`);

export function delta(cur: number, prev: number): { value: number | null; label: string } {
  if (!prev) return { value: null, label: cur ? "new" : "—" };
  const d = (cur - prev) / prev;
  return { value: d, label: `${d >= 0 ? "+" : ""}${(d * 100).toFixed(1)}%` };
}

export function fmtDuration(s: number | null | undefined) {
  if (s === null || s === undefined) return "—";
  if (s < 60) return `${Math.round(s)}s`;
  if (s < 3600) return `${Math.round(s / 60)}m`;
  if (s < 86400) return `${(s / 3600).toFixed(1)}h`;
  return `${(s / 86400).toFixed(1)}d`;
}

export function fmtTime(iso: string | null | undefined, tz?: string) {
  if (!iso) return "—";
  return new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: tz }).format(new Date(iso));
}

export function fmtRelative(iso: string | null | undefined) {
  if (!iso) return "never";
  const s = (Date.now() - new Date(iso).getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

export const RANGES = [
  { value: "-24h", label: "Last 24 hours" },
  { value: "-7d", label: "Last 7 days" },
  { value: "-14d", label: "Last 14 days" },
  { value: "-30d", label: "Last 30 days" },
  { value: "-90d", label: "Last 90 days" },
] as const;

export const rangeLabel = (v: string) => RANGES.find((r) => r.value === v)?.label ?? v;

export function personLabel(p: { properties: Record<string, unknown>; distinctIds: string[]; id: string }) {
  const email = p.properties.email;
  const name = p.properties.name;
  return (typeof name === "string" && name) || (typeof email === "string" && email) || p.distinctIds[0] || p.id.slice(0, 8);
}

export const withParam = (href: string, k: string, v: string) => `${href}${href.includes("?") ? "&" : "?"}${k}=${encodeURIComponent(v)}`;
