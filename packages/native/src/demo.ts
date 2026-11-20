/**
 * Deterministic synthetic dataset — clearly labeled DEMO DATA.
 *
 * Models a developer-hiring product's onboarding funnel with ONE known,
 * planted regression so investigations can be checked against ground truth:
 *
 *   From DEMO_REGRESSION_DAY onward (release "2.4.0"), Safari users hit
 *   `onboarding_error` (error_code=PROFILE_UPLOAD_413) on the profile step and
 *   most of them fail to reach `profile_completed`. Other browsers are unaffected.
 */
import { randomUUID } from "node:crypto";

export const DEMO_DAYS = 28;
export const DEMO_REGRESSION_DAY = 18; // day index (0-based) of the release
export const DEMO_RELEASE = "2.4.0";

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function uuidFrom(rand: () => number): string {
  const hex = Array.from({ length: 32 }, () => Math.floor(rand() * 16).toString(16)).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-${((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export interface DemoEvent {
  uuid: string;
  event: string;
  distinct_id: string;
  timestamp: string;
  properties: Record<string, unknown>;
}

export function generateDemoEvents(opts: { seed?: number; end?: Date; usersPerDay?: number } = {}): DemoEvent[] {
  const rand = mulberry32(opts.seed ?? 42);
  const end = opts.end ?? new Date();
  const dayStart = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate()) - (DEMO_DAYS - 1) * 86400_000;
  const browsers = [
    { name: "Chrome", w: 0.55 },
    { name: "Safari", w: 0.25 },
    { name: "Firefox", w: 0.12 },
    { name: "Edge", w: 0.08 },
  ];
  const refs = ["$direct", "google.com", "github.com", "news.ycombinator.com", "linkedin.com"];
  const utm = [null, null, "newsletter", "twitter", "partner"];
  const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)]!;
  const pickBrowser = () => {
    let r = rand();
    for (const b of browsers) {
      if ((r -= b.w) <= 0) return b.name;
    }
    return "Chrome";
  };
  const out: DemoEvent[] = [];
  // separate stream so adding LLM events doesn't change the rest of the dataset
  const ai = mulberry32((opts.seed ?? 42) + 7);
  const MODELS = [
    { model: "gpt-5-mini", provider: "openai", inCost: 0.25e-6, outCost: 2e-6, share: 0.6, latency: 1.1 },
    { model: "claude-sonnet-5", provider: "anthropic", inCost: 3e-6, outCost: 15e-6, share: 0.3, latency: 2.4 },
    { model: "gemini-3-flash", provider: "google", inCost: 0.3e-6, outCost: 2.5e-6, share: 0.1, latency: 0.9 },
  ];
  const perDay = opts.usersPerDay ?? 60;

  for (let d = 0; d < DEMO_DAYS; d++) {
    const n = Math.round(perDay * (0.8 + rand() * 0.4) * (new Date(dayStart + d * 86400_000).getUTCDay() % 6 === 0 ? 0.6 : 1));
    const release = d >= DEMO_REGRESSION_DAY ? DEMO_RELEASE : "2.3.2";
    for (let u = 0; u < n; u++) {
      const anon = `anon-${uuidFrom(rand).slice(0, 13)}`;
      const userId = `user_${d}_${u}`;
      const browser = pickBrowser();
      const device = rand() < 0.22 ? "Mobile" : "Desktop";
      const session = uuidFrom(rand);
      let t = dayStart + d * 86400_000 + Math.floor(rand() * 86400_000 * 0.9);
      if (t > end.getTime() - 60_000) continue;
      const base = {
        $browser: browser,
        $device_type: device,
        $session_id: session,
        $lib: "demo",
        app_version: release,
        $referring_domain: pick(refs),
        ...(pick(utm) ? { utm_source: pick(utm.filter(Boolean)) } : {}),
      };
      const push = (event: string, distinct: string, props: Record<string, unknown> = {}, gapS = 20) => {
        t += Math.floor(gapS * 1000 * (0.5 + rand()));
        out.push({ uuid: uuidFrom(rand), event, distinct_id: distinct, timestamp: new Date(t).toISOString(), properties: { ...base, ...props } });
      };
      push("$pageview", anon, { $pathname: "/", $current_url: "https://demo.hostpog.local/" });
      if (rand() < 0.4) push("$pageview", anon, { $pathname: "/pricing", $current_url: "https://demo.hostpog.local/pricing" });
      if (rand() > 0.62) continue; // bounced visitors
      push("$pageview", anon, { $pathname: "/signup", $current_url: "https://demo.hostpog.local/signup" });
      if (rand() > 0.7) continue;
      push("signed_up", anon, { plan: rand() < 0.15 ? "team" : "free" });
      push("$identify", userId, { $anon_distinct_id: anon, $set: { email: `${userId}@example.test`, signup_browser: browser } }, 1);
      if (rand() > 0.9) continue; // never starts onboarding
      push("onboarding_started", userId, { $pathname: "/onboarding" }, 30);
      const broken = d >= DEMO_REGRESSION_DAY && browser === "Safari";
      if (broken) {
        push("onboarding_error", userId, { error_code: "PROFILE_UPLOAD_413", step: "profile" }, 40);
        if (rand() < 0.82) continue;
      }
      if (rand() > 0.78) continue;
      push("profile_completed", userId, { $pathname: "/onboarding/profile" }, 90);
      if (rand() > 0.6) continue;
      push("first_project_created", userId, { $pathname: "/projects/new" }, 240);
      // activated users try the AI writing assistant: one $ai_generation per call (PostHog LLM analytics format)
      const calls = Math.floor(ai() * 5);
      for (let c = 0; c < calls; c++) {
        let r = ai();
        const m = MODELS.find((x) => (r -= x.share) < 0) ?? MODELS[0]!;
        const input = 300 + Math.floor(ai() * 2400);
        const output = 80 + Math.floor(ai() * 700);
        const error = ai() < 0.03;
        push(
          "$ai_generation",
          userId,
          {
            $ai_model: m.model,
            $ai_provider: m.provider,
            $ai_input_tokens: input,
            $ai_output_tokens: error ? 0 : output,
            $ai_latency: +(m.latency * (0.6 + ai() * 1.2)).toFixed(2),
            $ai_total_cost_usd: +(input * m.inCost + (error ? 0 : output * m.outCost)).toFixed(6),
            $ai_trace_id: uuidFrom(ai),
            $ai_is_error: error,
            ...(error ? { $ai_http_status: 529, $ai_error: "Overloaded" } : {}),
            $ai_input: [{ role: "user", content: "Rewrite this project description so it's clearer." }],
            $ai_output_choices: error ? [] : [{ role: "assistant", content: "Here's a clearer version: …" }],
          },
          60,
        );
      }
    }
  }
  return out;
}

export function newEventUuid() {
  return randomUUID();
}
