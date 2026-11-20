import { describe, expect, it } from "vitest";
import { compileEvents, compileFunnel, compileTrendSeries, SqlBuilder } from "../src/compiler";
import { bucketLabels, normalizeBucket } from "../src/shape";
import { previousRange, resolveRange } from "../src/range";

const range = { from: "2026-11-01T00:00:00.000Z", to: "2026-11-08T00:00:00.000Z" };

describe("compiler safety", () => {
  it("never inlines event names or filter values", () => {
    const evil = "x' OR 1=1 --";
    const q = compileTrendSeries(
      { event: evil, math: "total", filters: [{ type: "event", key: "$browser", operator: "eq", value: evil }] },
      [],
      "day",
      range,
      undefined,
      { dialect: "clickhouse", projectId: "p1", timezone: "UTC" },
    );
    expect(q.text).not.toContain(evil);
    expect(Object.values(q.params)).toContain(evil);
  });

  it("rejects unsafe property keys", () => {
    const b = new SqlBuilder("hogql", { timezone: "UTC" });
    expect(() => b.prop("event", "a']) OR 1=1 --")).toThrow(/unsafe/);
  });

  it("scopes every native query by project", () => {
    const q = compileEvents({ kind: "events", filters: [], dateRange: { from: "-1d", to: "now" }, limit: 10 }, range, {
      dialect: "clickhouse",
      projectId: "proj-A",
      timezone: "UTC",
    });
    expect(q.text).toMatch(/ev\.project_id = \{p\d+:String\}/);
    expect(Object.values(q.params)).toContain("proj-A");
  });

  it("requires a projectId for native queries", () => {
    expect(() => new SqlBuilder("clickhouse", { timezone: "UTC" })).toThrow();
  });

  it("uses windowFunnel with an integer window", () => {
    const q = compileFunnel(
      {
        kind: "funnel",
        steps: [
          { event: "a", filters: [] },
          { event: "b", filters: [] },
        ],
        windowSeconds: 3600,
        dateRange: { from: "-7d", to: "now" },
        filters: [],
      },
      range,
      { dialect: "hogql", timezone: "UTC" },
    );
    expect(q.text).toContain("windowFunnel(3600)");
    expect(q.text).toMatch(/toDateTime\(\{p\d+\}\)/);
  });
});

describe("ranges and buckets", () => {
  it("snaps relative ranges to UTC day starts and minute-aligned now", () => {
    const now = new Date("2026-11-18T15:30:12.345Z");
    expect(resolveRange({ from: "-7d", to: "now" }, now)).toEqual({ from: "2026-11-11T00:00:00.000Z", to: "2026-11-18T15:31:00.000Z" });
    expect(resolveRange({ from: "-24h", to: "now" }, now).from).toBe("2026-11-17T15:31:00.000Z");
  });

  it("snaps to local midnight in the reporting timezone", () => {
    const now = new Date("2026-11-18T15:30:00Z"); // 08:30 in Phoenix (UTC-7, no DST)
    expect(resolveRange({ from: "-7d", to: "now" }, now, "America/Phoenix").from).toBe("2026-11-11T07:00:00.000Z");
    expect(resolveRange({ from: "-1d", to: "now" }, new Date("2026-03-09T12:00:00Z"), "America/New_York").from).toBe("2026-03-08T05:00:00.000Z");
  });

  it("computes the previous period of equal length", () => {
    expect(previousRange(range)).toEqual({ from: "2026-10-25T00:00:00.000Z", to: "2026-11-01T00:00:00.000Z" });
  });

  it("generates timezone-aware day buckets", () => {
    const labels = bucketLabels({ from: "2026-11-02T07:00:00.000Z", to: "2026-11-04T07:00:00.000Z" }, "day", "America/Phoenix");
    expect(labels).toEqual(["2026-11-02", "2026-11-03"]);
  });

  it("weeks start on Sunday", () => {
    expect(bucketLabels({ from: "2026-11-18T00:00:00Z", to: "2026-11-19T00:00:00Z" }, "week", "UTC")).toEqual(["2026-11-15"]);
  });

  it("normalizes provider bucket strings", () => {
    expect(normalizeBucket("2026-11-03T00:00:00-07:00", "day")).toBe("2026-11-03");
    expect(normalizeBucket("2026-11-03 14:00:00", "hour")).toBe("2026-11-03 14:00");
  });
});
