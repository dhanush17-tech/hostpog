import { describe, expect, it } from "vitest";
import { evaluateFlag, flagHash, pickVariant, toPostHogFlagsResponse, type FlagDefinition } from "../src/flags";

// Reference values computed with @posthog/core 1.69.2 (getFeatureFlagHash / getFeatureFlagVariant).
const REF = [
  { k: "new-checkout", d: "user_1", h: 0.506178350600534, v: "control" },
  { k: "new-checkout", d: "anon-9944068c", h: 0.40473409075591754, v: "control" },
  { k: "beta", d: "alice@example.com", h: 0.46339176019275763, v: "control" },
  { k: "pricing-test", d: "42", h: 0.16411893236737163, v: "control" },
];
const flag = (over: Partial<FlagDefinition> = {}): FlagDefinition => ({
  id: "f1",
  key: "new-checkout",
  active: true,
  rolloutPercent: 100,
  conditions: [],
  variants: [],
  payloads: {},
  version: 1,
  ...over,
});

describe("feature flags", () => {
  it("buckets users exactly like PostHog", () => {
    for (const r of REF) {
      expect(flagHash(r.k, r.d)).toBe(r.h);
      expect(pickVariant(r.k, r.d, [{ key: "control", rolloutPercent: 50 }, { key: "test", rolloutPercent: 50 }])).toBe(r.v);
    }
  });
  it("respects rollout percentage", () => {
    // user_1 hashes to 0.506 for new-checkout
    expect(evaluateFlag(flag({ rolloutPercent: 50 }), "user_1").enabled).toBe(false);
    expect(evaluateFlag(flag({ rolloutPercent: 51 }), "user_1").enabled).toBe(true);
  });
  it("requires every condition to match", () => {
    const f = flag({ conditions: [{ property: "plan", operator: "eq", value: "pro" }, { property: "email", operator: "contains", value: "@acme.com" }] });
    expect(evaluateFlag(f, "u", { plan: "pro", email: "a@acme.com" }).enabled).toBe(true);
    expect(evaluateFlag(f, "u", { plan: "free", email: "a@acme.com" }).reason).toBe("condition_mismatch");
    expect(evaluateFlag(flag({ conditions: [{ property: "$distinct_id", operator: "in", value: "u1, u2" }] }), "u2").enabled).toBe(true);
  });
  it("returns variants and payloads in posthog-js format", () => {
    const f = flag({ variants: [{ key: "control", rolloutPercent: 50 }, { key: "test", rolloutPercent: 50 }], payloads: { control: { color: "blue" } } });
    const r = evaluateFlag(f, "user_1");
    expect(r).toMatchObject({ enabled: true, variant: "control", payload: { color: "blue" } });
    const body = toPostHogFlagsResponse([f], [r], "req");
    expect(body.flags["new-checkout"]).toMatchObject({ key: "new-checkout", enabled: true, variant: "control", metadata: { payload: '{"color":"blue"}' } });
    expect(evaluateFlag(flag({ active: false }), "user_1")).toMatchObject({ enabled: false, reason: "disabled" });
  });
});
