import { aiProviders, aiUsage, credentials, getDb } from "@hostpog/db";
import { generateText } from "ai";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/server/audit";
import { loadProvider, modelFor, monthUsage } from "@/server/ai";
import { requireWorkspace } from "@/server/authz";
import { body, ok, route } from "@/server/http";

type Ctx = { params: Promise<{ workspaceId: string; providerId: string }> };

const Patch = z.object({
  label: z.string().min(1).max(80).optional(),
  model: z.string().min(1).max(200).optional(),
  monthlyTokenBudget: z.number().int().min(1000).max(1_000_000_000).optional(),
  allowRawEvents: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

export const PATCH = route<Ctx>(async (req, { params }) => {
  const { workspaceId, providerId } = await params;
  const a = await requireWorkspace(workspaceId, "admin", req);
  const before = await loadProvider(workspaceId, providerId);
  const b = await body(req, Patch);
  // a test result belongs to the model it ran against: a new model starts untested
  const reset = b.model && b.model !== before.model ? { lastTestedAt: null, lastTestResult: null } : {};
  await getDb().update(aiProviders).set({ ...b, ...reset }).where(and(eq(aiProviders.id, providerId), eq(aiProviders.workspaceId, workspaceId)));
  await audit({ workspaceId, actorUserId: a.user.id, action: "ai_provider.update", target: providerId, meta: b, req });
  return ok({ updated: true });
});

/** Explicit user action: one minimal request to verify the key/endpoint. */
export const POST = route<Ctx>(async (req, { params }) => {
  const { workspaceId, providerId } = await params;
  const a = await requireWorkspace(workspaceId, "admin", req);
  const p = await loadProvider(workspaceId, providerId);
  const model = await modelFor(workspaceId, p);
  let result: string;
  try {
    const r = await generateText({ model, prompt: "Reply with the single word: ok", maxOutputTokens: 8, timeout: 20_000, maxRetries: 0 });
    result = `ok (${r.text.trim().slice(0, 20) || "empty reply"})`;
    await getDb()
      .insert(aiUsage)
      .values({ workspaceId, providerId: p.id, model: p.model, inputTokens: r.totalUsage.inputTokens ?? 0, outputTokens: r.totalUsage.outputTokens ?? 0, requests: 1 });
  } catch (e) {
    // provider error messages can include request details; keep it short and key-free
    result = `failed: ${(e as Error).message.replace(/(sk|key|token)[-_a-z0-9]{6,}/gi, "[redacted]").slice(0, 200)}`;
  }
  await getDb().update(aiProviders).set({ lastTestedAt: new Date(), lastTestResult: result }).where(eq(aiProviders.id, p.id));
  await audit({ workspaceId, actorUserId: a.user.id, action: "ai_provider.test", target: p.id, meta: { ok: result.startsWith("ok") }, req });
  return ok({ result, usage: await monthUsage(workspaceId, p.id) });
});

export const DELETE = route<Ctx>(async (req, { params }) => {
  const { workspaceId, providerId } = await params;
  const a = await requireWorkspace(workspaceId, "admin", req);
  const p = await loadProvider(workspaceId, providerId);
  const db = getDb();
  await db.delete(aiProviders).where(eq(aiProviders.id, p.id));
  if (p.credentialId) await db.delete(credentials).where(and(eq(credentials.id, p.credentialId), eq(credentials.workspaceId, workspaceId)));
  await audit({ workspaceId, actorUserId: a.user.id, action: "ai_provider.delete", target: p.id, req });
  return ok({ deleted: true });
});
