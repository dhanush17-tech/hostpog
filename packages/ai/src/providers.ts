/**
 * BYOK model adapters. Keys are decrypted only on the server, only for the
 * duration of a request, and are never logged or sent to the browser.
 * Model lists are discovered from each provider's models endpoint — HostPog does
 * not hardcode which models exist.
 */
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import type { LanguageModel } from "ai";
import { guardedFetch, normalizeEndpoint } from "./ssrf";

export type AiProviderKind = "openai" | "anthropic" | "google" | "openrouter" | "openai_compatible";

export interface AiProviderConfig {
  provider: AiProviderKind;
  model: string;
  apiKey: string | null;
  /** only for openai_compatible (and optional override for openrouter) */
  baseUrl?: string | null;
}

export const PROVIDER_INFO: Record<AiProviderKind, { label: string; defaultBaseUrl: string | null; keyHint: string; dataNote: string }> = {
  openai: { label: "OpenAI", defaultBaseUrl: "https://api.openai.com/v1", keyHint: "sk-…", dataNote: "Prompts and tool results are sent to OpenAI under your account's terms." },
  anthropic: { label: "Anthropic", defaultBaseUrl: "https://api.anthropic.com/v1", keyHint: "sk-ant-…", dataNote: "Prompts and tool results are sent to Anthropic under your account's terms." },
  google: { label: "Google Gemini", defaultBaseUrl: "https://generativelanguage.googleapis.com/v1beta", keyHint: "AIza…", dataNote: "Prompts and tool results are sent to Google under your account's terms." },
  openrouter: { label: "OpenRouter", defaultBaseUrl: "https://openrouter.ai/api/v1", keyHint: "sk-or-…", dataNote: "Prompts are routed by OpenRouter to the model provider you select." },
  openai_compatible: { label: "OpenAI-compatible / local", defaultBaseUrl: null, keyHint: "optional", dataNote: "Prompts go to the endpoint you configure. Local endpoints keep data on your infrastructure." },
};

function endpoint(cfg: AiProviderConfig): URL {
  const raw = cfg.baseUrl || PROVIDER_INFO[cfg.provider].defaultBaseUrl;
  if (!raw) throw new Error("an endpoint URL is required for OpenAI-compatible providers");
  return normalizeEndpoint(raw);
}

export function createModel(cfg: AiProviderConfig): LanguageModel {
  const url = endpoint(cfg);
  const f = guardedFetch(url);
  const baseURL = url.toString().replace(/\/$/, "");
  switch (cfg.provider) {
    case "openai":
      return createOpenAI({ apiKey: cfg.apiKey ?? "", baseURL, fetch: f })(cfg.model);
    case "anthropic":
      return createAnthropic({ apiKey: cfg.apiKey ?? "", baseURL, fetch: f })(cfg.model);
    case "google":
      return createGoogleGenerativeAI({ apiKey: cfg.apiKey ?? "", baseURL, fetch: f })(cfg.model);
    case "openrouter":
      return createOpenAICompatible({ name: "openrouter", apiKey: cfg.apiKey ?? "", baseURL, fetch: f })(cfg.model);
    case "openai_compatible":
      return createOpenAICompatible({ name: "custom", apiKey: cfg.apiKey ?? undefined, baseURL, fetch: f })(cfg.model);
  }
}

/** Discover models from the provider (requires a key for hosted providers). */
export async function listModels(cfg: Omit<AiProviderConfig, "model">, signal?: AbortSignal): Promise<string[]> {
  const url = endpoint({ ...cfg, model: "" });
  const f = guardedFetch(url);
  const base = url.toString().replace(/\/$/, "");
  let res: Response;
  if (cfg.provider === "anthropic") {
    res = await f(`${base}/models?limit=100`, { headers: { "x-api-key": cfg.apiKey ?? "", "anthropic-version": "2023-06-01" }, signal });
  } else if (cfg.provider === "google") {
    res = await f(`${base}/models?pageSize=200`, { headers: { "x-goog-api-key": cfg.apiKey ?? "" }, signal });
  } else {
    res = await f(`${base}/models`, { headers: cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {}, signal });
  }
  if (!res.ok) throw new Error(`model list failed (${res.status})`);
  const j = (await res.json()) as { data?: { id: string }[]; models?: { name: string; supportedGenerationMethods?: string[] }[] };
  if (j.models) {
    return j.models
      .filter((m) => !m.supportedGenerationMethods || m.supportedGenerationMethods.includes("generateContent"))
      .map((m) => m.name.replace(/^models\//, ""));
  }
  return (j.data ?? []).map((m) => m.id).sort();
}
