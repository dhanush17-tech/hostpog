import "server-only";
import { createModel, type AiProviderKind } from "@hostpog/ai";
import { aiProviders, aiUsage, getDb } from "@hostpog/db";
import { and, eq, gte, sql } from "drizzle-orm";
import { HttpError } from "./http";
import { decryptCredential } from "./sources";

export type AiProviderRow = typeof aiProviders.$inferSelect;

export function publicProvider(p: AiProviderRow, hint: string | null) {
  // never return secrets; hint is e.g. "sk-…a1b"
  return {
    id: p.id,
    provider: p.provider,
    label: p.label,
    model: p.model,
    baseUrl: p.baseUrl,
    keyHint: hint,
    monthlyTokenBudget: p.monthlyTokenBudget,
    allowRawEvents: p.allowRawEvents,
    enabled: p.enabled,
    lastTestedAt: p.lastTestedAt,
    lastTestResult: p.lastTestResult,
    createdAt: p.createdAt,
  };
}

export async function loadProvider(workspaceId: string, id: string) {
  const [p] = await getDb().select().from(aiProviders).where(and(eq(aiProviders.id, id), eq(aiProviders.workspaceId, workspaceId))).limit(1);
  if (!p) throw new HttpError(404, "AI provider not found");
  return p;
}

export async function modelFor(workspaceId: string, p: AiProviderRow) {
  const apiKey = p.credentialId ? (await decryptCredential(workspaceId, p.credentialId)).secret : null;
  if (!apiKey && p.provider !== "openai_compatible") throw new HttpError(400, "This provider has no API key configured");
  try {
    return createModel({ provider: p.provider as AiProviderKind, model: p.model, apiKey, baseUrl: p.baseUrl });
  } catch (e) {
    throw new HttpError(400, (e as Error).message, "endpoint_policy");
  }
}

export async function monthUsage(workspaceId: string, providerId?: string) {
  const start = new Date();
  start.setUTCDate(1);
  start.setUTCHours(0, 0, 0, 0);
  const conds = [eq(aiUsage.workspaceId, workspaceId), gte(aiUsage.createdAt, start)];
  if (providerId) conds.push(eq(aiUsage.providerId, providerId));
  const [r] = await getDb()
    .select({
      input: sql<number>`coalesce(sum(${aiUsage.inputTokens}),0)::int`,
      output: sql<number>`coalesce(sum(${aiUsage.outputTokens}),0)::int`,
      requests: sql<number>`coalesce(sum(${aiUsage.requests}),0)::int`,
    })
    .from(aiUsage)
    .where(and(...conds));
  return { inputTokens: r?.input ?? 0, outputTokens: r?.output ?? 0, requests: r?.requests ?? 0, since: start.toISOString() };
}

export async function assertBudget(workspaceId: string, p: AiProviderRow) {
  const u = await monthUsage(workspaceId, p.id);
  if (u.inputTokens + u.outputTokens >= p.monthlyTokenBudget) {
    throw new HttpError(429, `Monthly token budget for ${p.label} reached (${p.monthlyTokenBudget.toLocaleString()} tokens). Raise it in Settings → AI providers.`, "ai_budget");
  }
  return u;
}
