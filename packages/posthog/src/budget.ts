/**
 * Client-side request budgets, mirroring PostHog's documented per-key limits
 * (docs/posthog-contract.md). These keep HostPog well under the provider's
 * limits; live 429 + Retry-After responses always win.
 */
export type BudgetCategory = "query" | "analytics" | "crud";

export const DEFAULT_LIMITS: Record<BudgetCategory, { perMinute: number; perHour: number }> = {
  query: { perMinute: 240, perHour: 2400 },
  analytics: { perMinute: 240, perHour: 1200 },
  crud: { perMinute: 480, perHour: 4800 },
};

/** Operators can lower (never usefully raise) budgets: HOSTPOG_POSTHOG_BUDGET_FRACTION=0.5 */
function fraction(): number {
  const f = Number(process.env.HOSTPOG_POSTHOG_BUDGET_FRACTION ?? "0.8");
  return Number.isFinite(f) && f > 0 && f <= 1 ? f : 0.8;
}

export class RequestBudget {
  private hits = new Map<string, number[]>();
  constructor(private readonly limits = DEFAULT_LIMITS) {}

  /** Returns 0 if the request may proceed (and records it), else seconds to wait. */
  take(credentialKey: string, category: BudgetCategory, now = Date.now()): number {
    const key = `${credentialKey}:${category}`;
    const list = (this.hits.get(key) ?? []).filter((t) => t > now - 3600_000);
    const f = fraction();
    const perMinute = Math.max(1, Math.floor(this.limits[category].perMinute * f));
    const perHour = Math.max(1, Math.floor(this.limits[category].perHour * f));
    const lastMinute = list.filter((t) => t > now - 60_000);
    if (lastMinute.length >= perMinute) return Math.ceil((lastMinute[0]! + 60_000 - now) / 1000);
    if (list.length >= perHour) return Math.ceil((list[0]! + 3600_000 - now) / 1000);
    list.push(now);
    this.hits.set(key, list);
    return 0;
  }

  /** Usage for every budget key that starts with `prefix` (e.g. a credential id). */
  usage(prefix: string, now = Date.now()) {
    const out: Record<string, { lastMinute: number; lastHour: number; limitPerHour: number }> = {};
    for (const c of Object.keys(this.limits) as BudgetCategory[]) {
      let list: number[] = [];
      for (const [k, v] of this.hits) if (k.startsWith(prefix) && k.endsWith(`:${c}`)) list = list.concat(v.filter((t) => t > now - 3600_000));
      out[c] = { lastMinute: list.filter((t) => t > now - 60_000).length, lastHour: list.length, limitPerHour: Math.floor(this.limits[c].perHour * fraction()) };
    }
    return out;
  }
}

export const sharedBudget = new RequestBudget();
