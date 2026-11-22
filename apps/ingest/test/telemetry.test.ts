import { describe, expect, it } from "vitest";
import { bucket, buildPing, installId, telemetryEnabled } from "../src/telemetry";

const counts = { largestTeam: 7, workspaces: 2, projects: 4, events24h: 52_000, flags: 3, experiments: 0, surveys: 1, workflows: 0, aiProviders: 1, logs7d: 0 };

describe("telemetry", () => {
  it("buckets numbers coarsely", () => {
    expect(bucket(0, [1, 5, 20])).toBe("0");
    expect(bucket(1, [1, 5, 20])).toBe("1");
    expect(bucket(4, [1, 5, 20])).toBe("2-5");
    expect(bucket(7, [1, 5, 20])).toBe("6-20");
    expect(bucket(99, [1, 5, 20])).toBe("21+");
  });

  it("is off unless explicitly turned on with a valid key", () => {
    expect(telemetryEnabled({})).toBe(false);
    expect(telemetryEnabled({ HOSTPOG_TELEMETRY: "0", HOSTPOG_TELEMETRY_KEY: "hp_pk_abcdefghijklmnop" })).toBe(false);
    expect(telemetryEnabled({ HOSTPOG_TELEMETRY: "1", HOSTPOG_TELEMETRY_KEY: "" })).toBe(false);
    expect(telemetryEnabled({ HOSTPOG_TELEMETRY: "1", HOSTPOG_TELEMETRY_KEY: "hp_pk_abcdefghijklmnop" })).toBe(true);
  });

  it("derives a stable, one-way install id", () => {
    expect(installId("secret")).toBe(installId("secret"));
    expect(installId("secret")).not.toContain("secret");
    expect(installId("secret")).toHaveLength(32);
  });

  it("sends only buckets and booleans", () => {
    const p = buildPing(counts, "seed");
    expect(p.event).toBe("hostpog_install_ping");
    expect(p.properties).toMatchObject({ team_size: "6-20", projects: "4-10", events_per_day: "10001-100000", uses_flags: true, uses_experiments: false, uses_ai: true });
    for (const v of Object.values(p.properties)) expect(["string", "boolean"]).toContain(typeof v);
    expect(JSON.stringify(p)).not.toMatch(/@|https?:\/\/|hp_pk_|seed/);
  });
});
