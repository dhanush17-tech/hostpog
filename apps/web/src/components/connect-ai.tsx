"use client";
import { useQuery } from "@tanstack/react-query";
import { Check, CheckCircle2, ClipboardPaste, ExternalLink, Loader2, RefreshCw, Server } from "lucide-react";
import { useState } from "react";
import { apiGet, apiSend } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useProject } from "./project-context";
import { BrandLogo } from "./brand-logo";
import { CopyButton } from "./docs/copy-button";
import { Button, ErrorBox, Input } from "./ui";

type Kind = "google" | "anthropic" | "openai";

const PROVIDERS: { id: Kind; name: string; tag: string; keyUrl: string; prefix: string; free?: boolean }[] = [
  { id: "google", name: "Google Gemini", tag: "Free tier · no credit card", keyUrl: "https://aistudio.google.com/apikey", prefix: "AIza…", free: true },
  { id: "anthropic", name: "Claude", tag: "Anthropic · needs billing", keyUrl: "https://platform.claude.com/settings/keys", prefix: "sk-ant-…" },
  { id: "openai", name: "OpenAI", tag: "GPT models · needs billing", keyUrl: "https://platform.openai.com/api-keys", prefix: "sk-…" },
];

/** Recognise the provider from the key's prefix so people don't have to pick it. */
export function detectProvider(key: string): Kind | null {
  const k = key.trim();
  if (k.startsWith("sk-ant-")) return "anthropic";
  if (k.startsWith("AIza")) return "google";
  if (k.startsWith("sk-or-")) return null;
  if (k.startsWith("sk-")) return "openai";
  return null;
}

const NON_CHAT = /(embed|tts|audio|realtime|transcribe|search|image|dall-e|whisper|moderation|davinci|babbage|instruct|vision-preview|computer-use|live)/i;

/** "gemini-3.8-flash" → 3.8, "claude-sonnet-4-5-2025…" → 4.5, "gpt-5.2-mini" → 5.2 */
function version(m: string): number {
  const hit = /(\d+)(?:[.-](\d{1,2})(?!\d))?/.exec(m.replace(/-\d{6,8}$/, ""));
  return hit ? Number(hit[1]) + (hit[2] ? Number(hit[2]) / 100 : 0) : 0;
}

/**
 * Rank the models a key can use, best first: preferred family tier, then newest version,
 * stable before preview/experimental. Lists come from the provider, never hardcoded.
 */
export function rankModels(kind: Kind | "ollama" | string, models: string[]): string[] {
  const tiers: Record<string, RegExp[]> = {
    anthropic: [/sonnet/i, /opus/i, /haiku/i],
    google: [/^(models\/)?gemini-[\d.]+-flash$/i, /^(models\/)?gemini-[\d.]+-flash/i, /^(models\/)?gemini-[\d.]+-pro/i, /gemini/i],
    openai: [/^gpt-\d+(\.\d+)?-mini$/i, /^gpt-\d+(\.\d+)?$/i, /^gpt-4o(-mini)?$/i, /^gpt/i, /^o\d/i],
    ollama: [/llama|qwen|mistral|gemma|phi|deepseek/i],
  };
  const t = tiers[kind] ?? [];
  const usable = models.filter((m) => !NON_CHAT.test(m));
  const pool = usable.length ? usable : models;
  const tierOf = (m: string) => {
    const i = t.findIndex((re) => re.test(m));
    return i === -1 ? t.length : i;
  };
  const unstable = (m: string) => (/(preview|exp|experimental|beta|lite)/i.test(m) ? 1 : 0);
  return [...pool].sort((x, y) => tierOf(x) - tierOf(y) || unstable(x) - unstable(y) || version(y) - version(x) || x.localeCompare(y));
}

export function pickDefaultModel(kind: Kind | "ollama", models: string[]): string | null {
  return rankModels(kind, models)[0] ?? null;
}

interface Connected {
  id: string;
  name: string;
  model: string;
  models: string[];
  at: string;
  testOk: boolean;
  testNote: string | null;
}

type Phase = "idle" | "checking" | "saving" | "testing";
const PHASE_LABEL: Record<Exclude<Phase, "idle">, string> = { checking: "Checking your key…", saving: "Saving it securely…", testing: "Sending one test request…" };

/**
 * One-screen AI setup: get-key buttons that open the exact provider page, a single paste box that
 * recognises the provider, automatic validation + default model, and one-click local Ollama.
 */
export function ConnectAI({ onConnected, compact = false }: { onConnected?: () => void; compact?: boolean }) {
  const p = useProject();
  const [kind, setKind] = useState<Kind>("google");
  const [key, setKey] = useState("");
  const [detected, setDetected] = useState<Kind | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<Connected | null>(null);
  const local = useQuery({
    queryKey: ["ai-local", p.workspaceId],
    queryFn: () => apiGet<{ detected: boolean; baseUrl?: string; models?: string[]; allowed?: boolean; host?: string }>(`/api/v1/workspaces/${p.workspaceId}/ai-local`),
    staleTime: 60_000,
  });
  const info = PROVIDERS.find((x) => x.id === kind)!;

  const onKey = (v: string) => {
    setKey(v);
    setErr(null);
    const d = detectProvider(v);
    setDetected(d);
    if (d) setKind(d);
  };

  const finish = async (provider: Kind | "openai_compatible", name: string, body: Record<string, unknown>, models: string[], model: string) => {
    setPhase("saving");
    const r = await apiSend<{ provider: { id: string } }>(`/api/v1/workspaces/${p.workspaceId}/ai-providers`, "POST", {
      provider,
      label: name,
      model,
      monthlyTokenBudget: 2_000_000,
      ...body,
    });
    setPhase("testing");
    const test = async () => {
      try {
        const t = await apiSend<{ result: string }>(`/api/v1/workspaces/${p.workspaceId}/ai-providers/${r.provider.id}`, "POST", {});
        return t.result.startsWith("ok") ? null : t.result.replace(/^failed:\s*/, "");
      } catch (e) {
        return (e as Error).message;
      }
    };
    // If the first pick fails (e.g. a model the provider still lists but no longer serves), try the next two.
    let chosen = model;
    let testNote = await test();
    const fallbacks = rankModels(provider === "openai_compatible" ? "ollama" : provider, models).filter((m) => m !== model).slice(0, 2);
    for (const alt of fallbacks) {
      if (!testNote) break;
      await apiSend(`/api/v1/workspaces/${p.workspaceId}/ai-providers/${r.provider.id}`, "PATCH", { model: alt });
      chosen = alt;
      testNote = await test();
    }
    const testOk = !testNote;
    if (testOk && chosen !== model) testNote = `${model} isn't available on your account, so we picked ${chosen}.`;
    setDone({ id: r.provider.id, name, model: chosen, models, at: new Date().toISOString(), testOk, testNote });
    setKey("");
    onConnected?.();
  };

  const connectKey = async () => {
    setErr(null);
    setPhase("checking");
    try {
      let models: string[];
      try {
        models = (await apiSend<{ models: string[] }>(`/api/v1/workspaces/${p.workspaceId}/ai-models`, "POST", { provider: kind, apiKey: key.trim() })).models;
      } catch (e) {
        const msg = (e as Error).message;
        if (/\((401|403)\)/.test(msg)) throw new Error(`${info.name} didn't accept that key. Nothing was saved — check you copied the whole key (it starts with ${info.prefix}) and try again.`);
        throw new Error(`Couldn't reach ${info.name} to check the key, so nothing was saved. Try again in a moment.`);
      }
      const model = pickDefaultModel(kind, models);
      if (!model) throw new Error(`That key works, but it can't use any chat models yet. Check your ${info.name} account, then try again. Nothing was saved.`);
      await finish(kind, info.name, { apiKey: key.trim() }, models, model);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setPhase("idle");
    }
  };

  const connectLocal = async () => {
    const d = local.data;
    if (!d?.detected || !d.baseUrl) return;
    setErr(null);
    const model = pickDefaultModel("ollama", d.models ?? []);
    if (!model) {
      setErr("Ollama is running but has no models yet. Run `ollama pull llama3.1` (or any model), then click Re-check.");
      return;
    }
    try {
      await finish("openai_compatible", "Ollama (local)", { baseUrl: d.baseUrl }, d.models ?? [], model);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setPhase("idle");
    }
  };

  if (done) {
    const at = new Date(done.at).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
    return (
      <div className="rounded-xl border border-line bg-panel p-4 shadow-card">
        <div className="flex items-start gap-3">
          <span className={cn("flex size-8 shrink-0 items-center justify-center rounded-lg", done.testOk ? "bg-[color-mix(in_srgb,var(--pos)_12%,transparent)] text-pos" : "bg-[color-mix(in_srgb,var(--warn)_14%,transparent)] text-warn")}>
            <CheckCircle2 size={17} aria-hidden />
          </span>
          <div className="min-w-0 flex-1 text-[13px]">
            <p className="font-medium">
              {done.name} connected at {at}
            </p>
            <p className="mt-0.5 text-ink-3">
              {done.testOk
                ? `Test request succeeded. ${done.testNote ? `${done.testNote} ` : ""}Investigations will use this model. Spending limit: 2M tokens a month — change it any time in AI providers.`
                : `Saved, but the test request failed: ${done.testNote}. Try a different model below.`}
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <label htmlFor="ai-model" className="text-[12px] text-ink-3">
                Model
              </label>
              <select
                id="ai-model"
                className="hp-select h-8 max-w-[280px] rounded-lg border border-line bg-panel pl-2.5 pr-7 text-[13px]"
                value={done.model}
                onChange={async (e) => {
                  const model = e.target.value;
                  await apiSend(`/api/v1/workspaces/${p.workspaceId}/ai-providers/${done.id}`, "PATCH", { model });
                  setDone({ ...done, model });
                  onConnected?.();
                }}
              >
                {[...new Set([done.model, ...done.models])].map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const busy = phase !== "idle";
  return (
    <div className="space-y-4 text-left">
      <div className={cn("grid gap-3", compact ? "sm:grid-cols-3" : "md:grid-cols-3")}>
        {PROVIDERS.map((x) => {
          const on = kind === x.id;
          return (
            <div
              key={x.id}
              role="radio"
              aria-checked={on}
              tabIndex={0}
              onClick={() => setKind(x.id)}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), setKind(x.id))}
              className={cn(
                "cursor-pointer rounded-xl border bg-panel p-4 shadow-card outline-none transition",
                on ? "border-[var(--chart-1)] ring-3 ring-[color-mix(in_srgb,var(--chart-1)_15%,transparent)]" : "border-line hover:border-line-strong",
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="flex items-center gap-2 text-[14px] font-semibold">
                  <BrandLogo id={x.id === "google" ? "gemini" : x.id === "anthropic" ? "claude" : "openai"} size={18} />
                  {x.name}
                </p>
                <span className={cn("flex size-4 shrink-0 items-center justify-center rounded-full border", on ? "border-[var(--chart-1)] bg-[var(--chart-1)] text-white" : "border-line-strong")} aria-hidden>
                  {on && <Check size={10} strokeWidth={3.5} />}
                </span>
              </div>
              <p className={cn("mt-0.5 text-[12px]", x.free ? "font-medium text-pos" : "text-ink-3")}>{x.tag}</p>
              <a
                href={x.keyUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => {
                  e.stopPropagation();
                  setKind(x.id);
                }}
                className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg border border-line bg-panel px-2.5 text-[12px] font-medium text-ink hover:bg-panel-2"
              >
                Get {x.id === "google" ? "a free" : "a"} key <ExternalLink size={12} aria-hidden />
              </a>
            </div>
          );
        })}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (key.trim() && !busy) void connectKey();
        }}
        className="rounded-xl border border-line bg-panel p-4 shadow-card"
      >
        <label htmlFor="ai-key" className="text-[13px] font-medium">
          Paste your {info.name} key
        </label>
        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <div className="relative flex-1">
            <Input
              id="ai-key"
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={info.prefix}
              value={key}
              onChange={(e) => onKey(e.target.value)}
              className="h-10 pr-10"
              disabled={busy}
            />
            <button
              type="button"
              aria-label="Paste from clipboard"
              title="Paste from clipboard"
              disabled={busy}
              onClick={async () => {
                try {
                  onKey(await navigator.clipboard.readText());
                } catch {
                  setErr("Your browser blocked clipboard access — paste with ⌘V instead.");
                }
              }}
              className="absolute right-1.5 top-1.5 flex size-7 items-center justify-center rounded-md text-ink-3 hover:bg-panel-2 hover:text-ink"
            >
              <ClipboardPaste size={15} />
            </button>
          </div>
          <Button type="submit" variant="primary" className="h-10 px-4 text-[14px]" disabled={!key.trim() || busy} loading={busy}>
            {busy ? PHASE_LABEL[phase as Exclude<Phase, "idle">] : "Connect"}
          </Button>
        </div>
        <p className="mt-2 text-[12px] text-ink-3">
          {detected ? (
            <span className="font-medium text-pos">Recognised a {PROVIDERS.find((x) => x.id === detected)!.name} key. </span>
          ) : null}
          We check the key, pick a good default model and send one tiny test request. Your key is encrypted and never shown again.
        </p>
        {err && (
          <div className="mt-3">
            <ErrorBox error={err} />
          </div>
        )}
      </form>

      {local.data?.detected ? (
        <div className="flex flex-wrap items-start gap-3 rounded-xl border border-line bg-panel p-4 shadow-card">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-line bg-panel">
            <BrandLogo id="ollama" size={18} />
          </span>
          <div className="min-w-0 flex-1 text-[13px]">
            <p className="font-medium">
              Ollama detected on this server · {local.data.models?.length ?? 0} {local.data.models?.length === 1 ? "model" : "models"}
            </p>
            <p className="text-ink-3">
              {local.data.allowed ? "Runs entirely on your machine — no key, nothing leaves your infrastructure." : "One setting first: allow hostpog to talk to it. Add this line to .env, then restart hostpog."}
            </p>
            {!local.data.allowed && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code className="rounded-md border border-line bg-panel-2 px-2 py-1 font-mono text-[12px]">HOSTPOG_AI_ALLOWED_PRIVATE_HOSTS={local.data.host}</code>
                <CopyButton text={`HOSTPOG_AI_ALLOWED_PRIVATE_HOSTS=${local.data.host}`} className="h-7 px-2 text-[12px]" />
              </div>
            )}
          </div>
          {local.data.allowed && (
            <Button variant="primary" disabled={busy} onClick={connectLocal}>
              Use local model
            </Button>
          )}
        </div>
      ) : (
        !compact && (
          <p className="flex flex-wrap items-center gap-2 text-[12px] text-ink-3">
            {local.isFetching ? <Loader2 size={12} className="animate-spin" aria-hidden /> : <Server size={12} aria-hidden />}
            Self-hosting? Start Ollama on the same machine and we&apos;ll offer it here automatically.
            <button onClick={() => local.refetch()} className="inline-flex items-center gap-1 font-medium text-ink-2 hover:text-ink">
              <RefreshCw size={11} aria-hidden /> Re-check
            </button>
          </p>
        )
      )}

    </div>
  );
}
