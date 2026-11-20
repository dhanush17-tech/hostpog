#!/usr/bin/env node
// Ingest load test. Sends realistic posthog-like events to /v1/batch at a fixed concurrency and reports
// throughput and latency percentiles.
//   node scripts/loadtest/ingest.mjs --url http://localhost:3001 --key hp_pk_... [--seconds 30] [--concurrency 16] [--batch 50] [--users 5000]
import { randomUUID } from "node:crypto";

const arg = (n, d) => {
  const i = process.argv.indexOf(`--${n}`);
  return i > 0 ? process.argv[i + 1] : d;
};
const URL_ = arg("url", "http://localhost:3001");
const KEY = arg("key");
const SECONDS = Number(arg("seconds", 30));
const CONC = Number(arg("concurrency", 16));
const BATCH = Number(arg("batch", 50));
const USERS = Number(arg("users", 5000));
const IDENTIFY_RATE = Number(arg("identify-rate", 0.02));
if (!KEY) {
  console.error("--key is required");
  process.exit(1);
}
const EVENTS = ["$pageview", "$pageview", "$pageview", "$autocapture", "button_clicked", "signed_up", "$pageleave"];
const PATHS = ["/", "/pricing", "/docs", "/blog/launch", "/app", "/app/settings"];
const rnd = (a) => a[Math.floor(Math.random() * a.length)];

function event() {
  const u = Math.floor(Math.random() * USERS);
  const identify = Math.random() < IDENTIFY_RATE;
  return {
    uuid: randomUUID(),
    event: identify ? "$identify" : rnd(EVENTS),
    distinct_id: identify ? `user_${u}` : `anon_${u}`,
    timestamp: new Date().toISOString(),
    properties: {
      $current_url: `https://example.com${rnd(PATHS)}`,
      $pathname: rnd(PATHS),
      $browser: rnd(["Chrome", "Safari", "Firefox"]),
      $os: rnd(["Mac OS X", "Windows", "iOS", "Android"]),
      $session_id: `s_${u}_${Math.floor(Date.now() / 1800_000)}`,
      $lib: "loadtest",
      ...(identify ? { $anon_distinct_id: `anon_${u}`, $set: { plan: rnd(["free", "pro"]) } } : {}),
    },
  };
}

const lat = [];
let sent = 0;
let ok = 0;
let failed = 0;
const errors = new Map();
const end = Date.now() + SECONDS * 1000;

async function worker() {
  while (Date.now() < end) {
    const batch = Array.from({ length: BATCH }, event);
    const t = performance.now();
    try {
      const r = await fetch(`${URL_}/v1/batch`, {
        method: "POST",
        headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
        body: JSON.stringify({ batch }),
      });
      const ms = performance.now() - t;
      lat.push(ms);
      sent += BATCH;
      if (r.ok) ok += BATCH;
      else {
        failed += BATCH;
        const k = `HTTP ${r.status}`;
        errors.set(k, (errors.get(k) ?? 0) + 1);
        await r.text();
      }
    } catch (e) {
      failed += BATCH;
      const k = String(e.cause?.code ?? e.message).slice(0, 60);
      errors.set(k, (errors.get(k) ?? 0) + 1);
    }
  }
}

const started = Date.now();
await Promise.all(Array.from({ length: CONC }, worker));
const secs = (Date.now() - started) / 1000;
lat.sort((a, b) => a - b);
const p = (q) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(q * lat.length))].toFixed(0) : "-");
const result = {
  seconds: +secs.toFixed(1),
  concurrency: CONC,
  batch: BATCH,
  eventsAccepted: ok,
  eventsFailed: failed,
  eventsPerSec: Math.round(ok / secs),
  requestLatencyMs: { p50: p(0.5), p95: p(0.95), p99: p(0.99) },
  errors: Object.fromEntries(errors),
};
console.log(JSON.stringify(result, null, 2));
