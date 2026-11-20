import { describe, expect, it } from "vitest";
import { HostPog, parseUserAgent, sanitizeUrl } from "../src/index";

function memStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    get length() {
      return m.size;
    },
  };
}

function sdk(statuses: number[] = [200]) {
  const sent: { url: string; body: any }[] = [];
  let i = 0;
  const hp = new HostPog().init("hp_pk_test_key_0123456789", {
    host: "http://ingest.test/",
    storage: memStorage(),
    flushIntervalMs: 1_000_000,
    batchSize: 100,
    transport: async (url, body) => {
      sent.push({ url, body: JSON.parse(body) });
      return { status: statuses[Math.min(i++, statuses.length - 1)]! };
    },
  });
  return { hp, sent };
}

describe("@hostpog/js", () => {
  it("batches events to /v1/batch with the project key", async () => {
    const { hp, sent } = sdk();
    hp.capture("signed_up", { plan: "free" });
    hp.capture("clicked");
    await hp.flush();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.url).toBe("http://ingest.test/v1/batch");
    expect(sent[0]!.body.api_key).toBe("hp_pk_test_key_0123456789");
    expect(sent[0]!.body.batch.map((e: any) => e.event)).toEqual(["signed_up", "clicked"]);
    expect(sent[0]!.body.batch[0].properties).toMatchObject({ plan: "free", $lib: "hostpog-js" });
    await hp.shutdown();
  });

  it("identify links the anonymous id", async () => {
    const { hp, sent } = sdk();
    const anon = hp.distinctId;
    hp.identify("user_1", { email: "u@example.test" });
    hp.capture("after");
    await hp.flush();
    const [identify, after] = sent[0]!.body.batch;
    expect(identify).toMatchObject({ event: "$identify", distinct_id: "user_1", properties: { $anon_distinct_id: anon, $set: { email: "u@example.test" } } });
    expect(after.distinct_id).toBe("user_1");
    hp.reset();
    expect(hp.distinctId).not.toBe("user_1");
    await hp.shutdown();
  });

  it("honours opt-out before anything is queued", async () => {
    const { hp, sent } = sdk();
    hp.optOut();
    hp.capture("secret");
    await hp.flush();
    expect(sent).toHaveLength(0);
    hp.optIn();
    hp.capture("ok");
    await hp.flush();
    expect(sent[0]!.body.batch.map((e: any) => e.event)).toEqual(["ok"]);
    await hp.shutdown();
  });

  it("keeps events on 5xx/429 and drops them on other 4xx", async () => {
    const { hp, sent } = sdk([503, 200]);
    hp.capture("a");
    await hp.flush(); // 503 -> kept, backoff
    await hp.flush({ beacon: true }); // beacon bypasses backoff -> 200
    expect(sent).toHaveLength(2);
    expect(sent[1]!.body.batch[0].uuid).toBe(sent[0]!.body.batch[0].uuid); // same uuid => server dedupes
    await hp.shutdown();
    const bad = sdk([400]);
    bad.hp.capture("x");
    await bad.hp.flush();
    await bad.hp.flush();
    expect(bad.sent).toHaveLength(1);
    await bad.hp.shutdown();
  });

  it("strips query strings except utm_* and allowlisted params", () => {
    expect(sanitizeUrl("https://a.test/p?token=abc&utm_source=x&q=1#frag", ["q"])).toBe("https://a.test/p?utm_source=x&q=1");
    expect(sanitizeUrl("https://user:pw@a.test/?reset=secret")).toBe("https://a.test/");
  });

  it("parses common user agents", () => {
    expect(parseUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15")).toEqual({
      $browser: "Safari",
      $os: "macOS",
      $device_type: "Desktop",
    });
  });

  it("rejects non-project keys", () => {
    expect(() => new HostPog().init("phx_secret", { host: "x" })).toThrow(/hp_pk_/);
  });
});
