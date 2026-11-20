/**
 * Redaction applied to every tool result before it reaches a model provider.
 * Default posture: aggregates pass through; row-level data is reduced to an
 * allowlist of non-identifying properties, emails/IP-like strings are masked,
 * and everything is size-bounded.
 */
const SENSITIVE_KEY = /(pass(word)?|secret|token|auth|cookie|session_token|api[_-]?key|card|cvv|ssn|phone|address|ip$|^\$ip$)/i;
const EMAIL = /([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})/g;
const IPV4 = /\b(\d{1,3})\.\d{1,3}\.\d{1,3}\.(\d{1,3})\b/g;

/** Event properties a model may see by default (no raw PII). */
export const SAFE_EVENT_PROPS = new Set([
  "$browser",
  "$browser_version",
  "$os",
  "$device_type",
  "$pathname",
  "$referring_domain",
  "$lib",
  "$lib_version",
  "$screen_width",
  "$viewport_width",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "app_version",
  "release",
  "plan",
  "error_code",
  "step",
  "$exception_type",
]);

export function maskString(s: string, max = 300): string {
  return s.replace(EMAIL, "$1***@$2").replace(IPV4, "$1.x.x.$2").slice(0, max);
}

export function redactValue(v: unknown, depth = 0): unknown {
  if (depth > 5) return "[truncated]";
  if (typeof v === "string") return maskString(v);
  if (Array.isArray(v)) return v.slice(0, 50).map((x) => redactValue(x, depth + 1));
  if (v && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(v).slice(0, 100)) {
      if (SENSITIVE_KEY.test(k)) continue;
      out[k] = redactValue(val, depth + 1);
    }
    return out;
  }
  return v;
}

export function redactEventProperties(props: Record<string, unknown>, allowRaw: boolean): Record<string, unknown> {
  if (allowRaw) return redactValue(props) as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(props)) if (SAFE_EVENT_PROPS.has(k)) out[k] = redactValue(v);
  return out;
}

/** Hard cap on serialized size of a tool result shown to the model. */
export function bound<T>(value: T, maxChars = 12_000): T | { truncated: true; preview: string } {
  const s = JSON.stringify(value);
  if (s.length <= maxChars) return value;
  return { truncated: true, preview: s.slice(0, maxChars) };
}
