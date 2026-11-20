/**
 * Feature flag evaluation. Bucketing matches PostHog's algorithm (sha1 of "<key>.<distinct_id><salt>", first 15 hex
 * digits / 0xfffffffffffffff), so a user who was in a rollout or variant on PostHog stays there after switching.
 */
import { createHash } from "node:crypto";
import type { FlagCondition, FlagVariant } from "@hostpog/db";

const LONG_SCALE = 0xfffffffffffffff;

export interface FlagDefinition {
  id: string;
  key: string;
  name?: string;
  active: boolean;
  rolloutPercent: number;
  conditions: FlagCondition[];
  variants: FlagVariant[];
  payloads: Record<string, unknown>;
  version: number;
}

export interface FlagResult {
  key: string;
  enabled: boolean;
  variant?: string;
  /** JSON-serialisable payload for the resolved value, if any */
  payload?: unknown;
  reason: "disabled" | "condition_mismatch" | "out_of_rollout" | "match";
}

export function flagHash(key: string, distinctId: string, salt = ""): number {
  const hex = createHash("sha1").update(`${key}.${distinctId}${salt}`).digest("hex");
  return parseInt(hex.slice(0, 15), 16) / LONG_SCALE;
}

export function pickVariant(key: string, distinctId: string, variants: FlagVariant[]): string | undefined {
  const h = flagHash(key, distinctId, "variant");
  let min = 0;
  for (const v of variants) {
    const max = min + v.rolloutPercent / 100;
    if (h >= min && h < max) return v.key;
    min = max;
  }
  return undefined;
}

function str(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  return typeof v === "string" ? v : typeof v === "object" ? JSON.stringify(v) : String(v);
}

export function conditionMatches(c: FlagCondition, distinctId: string, props: Record<string, unknown>): boolean {
  const actual = c.property === "$distinct_id" ? distinctId : str(props[c.property]);
  const want = c.value;
  switch (c.operator) {
    case "is_set":
      return actual !== null;
    case "is_not_set":
      return actual === null;
    case "eq":
      return actual !== null && actual.toLowerCase() === String(want ?? "").toLowerCase();
    case "neq":
      return actual === null || actual.toLowerCase() !== String(want ?? "").toLowerCase();
    case "contains":
      return actual !== null && actual.toLowerCase().includes(String(want ?? "").toLowerCase());
    case "not_contains":
      return actual === null || !actual.toLowerCase().includes(String(want ?? "").toLowerCase());
    case "in": {
      const list = Array.isArray(want) ? want : String(want ?? "").split(",");
      return actual !== null && list.map((x) => String(x).trim().toLowerCase()).includes(actual.toLowerCase());
    }
    case "gt":
    case "lt": {
      const a = Number(actual);
      const b = Number(want);
      if (actual === null || Number.isNaN(a) || Number.isNaN(b)) return false;
      return c.operator === "gt" ? a > b : a < b;
    }
  }
}

export function evaluateFlag(f: FlagDefinition, distinctId: string, props: Record<string, unknown> = {}): FlagResult {
  if (!f.active) return { key: f.key, enabled: false, reason: "disabled" };
  if (!f.conditions.every((c) => conditionMatches(c, distinctId, props))) return { key: f.key, enabled: false, reason: "condition_mismatch" };
  if (f.rolloutPercent < 100 && flagHash(f.key, distinctId) > f.rolloutPercent / 100) return { key: f.key, enabled: false, reason: "out_of_rollout" };
  const variant = f.variants.length ? pickVariant(f.key, distinctId, f.variants) : undefined;
  if (f.variants.length && !variant) return { key: f.key, enabled: false, reason: "out_of_rollout" };
  const payload = f.payloads[variant ?? "true"];
  return { key: f.key, enabled: true, ...(variant ? { variant } : {}), ...(payload !== undefined ? { payload } : {}), reason: "match" };
}

/** posthog-js /flags?v=2 response body for a set of results. */
export function toPostHogFlagsResponse(defs: FlagDefinition[], results: FlagResult[], requestId: string) {
  const byKey = new Map(defs.map((d) => [d.key, d]));
  return {
    flags: Object.fromEntries(
      results.map((r) => {
        const d = byKey.get(r.key);
        return [
          r.key,
          {
            key: r.key,
            enabled: r.enabled,
            variant: r.variant,
            reason: { code: r.reason === "match" ? "condition_match" : r.reason, condition_index: 0, description: r.reason.replace(/_/g, " ") },
            metadata: { id: undefined, version: d?.version, description: d?.name || undefined, payload: r.payload !== undefined ? JSON.stringify(r.payload) : undefined },
          },
        ];
      }),
    ),
    errorsWhileComputingFlags: false,
    requestId,
  };
}
