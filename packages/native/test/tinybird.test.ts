import { describe, expect, it } from "vitest";
import { bindParams } from "../src/tinybird";

describe("bindParams", () => {
  it("binds strings, numbers, datetimes and arrays as typed literals", () => {
    const sql = "SELECT * FROM events WHERE project_id = {p0:String} AND n > {p1:Int64} AND t >= {p2:DateTime64(3)} AND e IN {p3:Array(String)}";
    expect(bindParams(sql, { p0: "abc", p1: 5, p2: "2026-11-01 00:00:00.000", p3: ["a", "b"] })).toBe(
      "SELECT * FROM events WHERE project_id = 'abc' AND n > 5 AND t >= CAST('2026-11-01 00:00:00.000' AS DateTime64(3)) AND e IN ['a', 'b']",
    );
  });
  it("escapes quotes and backslashes so values can't break out of the literal", () => {
    expect(bindParams("x = {p:String}", { p: "a' OR 1=1 --\\" })).toBe("x = 'a\\' OR 1=1 --\\\\'");
  });
  it("rejects non-numeric values for numeric types", () => {
    expect(() => bindParams("x = {p:Int64}", { p: "1; DROP" })).toThrow();
  });
  it("leaves unknown placeholders untouched", () => {
    expect(bindParams("x = {q:String}", { p: "a" })).toBe("x = {q:String}");
  });
});

describe("TinybirdClient.insert", () => {
  it("sends UInt64 version columns as bare numbers", async () => {
    const { TinybirdClient } = await import("../src/tinybird");
    let body = "";
    const orig = globalThis.fetch;
    globalThis.fetch = (async (_u: string, init: RequestInit) => {
      body = String(init.body);
      return new Response(JSON.stringify({ successful_rows: 1, quarantined_rows: 0 }), { status: 200 });
    }) as typeof fetch;
    try {
      await new TinybirdClient("https://tb.example", "t").insert({ table: "person_props", values: [{ project_id: "p", version: "1795109262363558123", props: { version: "1" } }] });
    } finally {
      globalThis.fetch = orig;
    }
    expect(body).toBe('{"project_id":"p","version":1795109262363558123,"props":{"version":"1"}}');
  });
});
