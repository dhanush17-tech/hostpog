import { createHash } from "node:crypto";

function stable(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  const keys = Object.keys(value as Record<string, unknown>).sort();
  return `{${keys
    .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${stable((value as Record<string, unknown>)[k])}`)
    .join(",")}}`;
}

/** Deterministic fingerprint for cache keys and evidence references. */
export function fingerprint(...parts: unknown[]): string {
  return createHash("sha256").update(parts.map(stable).join("|")).digest("hex").slice(0, 24);
}
