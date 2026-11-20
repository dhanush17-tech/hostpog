import { describe, expect, it } from "vitest";
import { generateDemoLogs, parseLogs } from "../src/logs";

const now = new Date("2026-11-19T12:00:00Z");

describe("parseLogs", () => {
  it("reads OTLP JSON: service, level, attributes, distinct id, time", () => {
    const { rows, rejected } = parseLogs(
      {
        resourceLogs: [
          {
            resource: { attributes: [{ key: "service.name", value: { stringValue: "billing" } }] },
            scopeLogs: [
              {
                logRecords: [
                  { timeUnixNano: "1795075200000000000", severityNumber: 17, body: { stringValue: "card declined" }, attributes: [{ key: "posthog.distinct_id", value: { stringValue: "u1" } }, { key: "amount", value: { intValue: "42" } }], traceId: "t1" },
                  { severityText: "WARNING", body: { stringValue: "slow" } },
                  { body: {} },
                ],
              },
            ],
          },
        ],
      },
      "p1",
      now,
    );
    expect(rejected).toBe(1);
    expect(rows[0]).toMatchObject({ project_id: "p1", level: "error", service: "billing", message: "card declined", distinct_id: "u1", trace_id: "t1", timestamp: "2026-11-19 08:00:00.000" });
    expect(rows[0]!.attributes).toMatchObject({ "service.name": "billing", amount: "42" });
    expect(rows[1]).toMatchObject({ level: "warn", timestamp: "2026-11-19 12:00:00.000" });
  });

  it("reads the simple format and clamps future timestamps", () => {
    const { rows } = parseLogs({ logs: [{ message: "hi", level: "debug", timestamp: "2030-01-01T00:00:00Z", attributes: { n: 1 } }, { level: "info" }] }, "p1", now);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ level: "debug", timestamp: "2026-11-19 12:00:00.000", attributes: { n: "1" } });
  });

  it("ignores bodies it doesn't understand", () => {
    expect(parseLogs("nope", "p1").rows).toEqual([]);
    expect(parseLogs({ resourceLogs: "x" }, "p1").rows).toEqual([]);
  });

  it("demo logs are deterministic and include an error burst", () => {
    const a = generateDemoLogs("p1", { end: now });
    expect(a).toEqual(generateDemoLogs("p1", { end: now }));
    expect(a.filter((r) => r.level === "error").length).toBeGreaterThan(50);
  });
});
