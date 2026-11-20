import { listModels, type AiProviderKind } from "@hostpog/ai";
import { z } from "zod";
import { loadProvider } from "@/server/ai";
import { requireWorkspace } from "@/server/authz";
import { body, HttpError, ok, route } from "@/server/http";
import { decryptCredential } from "@/server/sources";

type Ctx = { params: Promise<{ workspaceId: string }> };

const Input = z.object({
  providerId: z.string().uuid().optional(),
  provider: z.enum(["openai", "anthropic", "google", "openrouter", "openai_compatible"]).optional(),
  apiKey: z.string().max(500).optional(),
  baseUrl: z.string().max(500).optional(),
});

/** Explicit action: ask the provider which models this key can use (no hardcoded lists). */
export const POST = route<Ctx>(async (req, { params }) => {
  const { workspaceId } = await params;
  await requireWorkspace(workspaceId, "admin", req);
  const b = await body(req, Input);
  let cfg: { provider: AiProviderKind; apiKey: string | null; baseUrl: string | null };
  if (b.providerId) {
    const p = await loadProvider(workspaceId, b.providerId);
    cfg = { provider: p.provider as AiProviderKind, apiKey: p.credentialId ? (await decryptCredential(workspaceId, p.credentialId)).secret : null, baseUrl: p.baseUrl };
  } else {
    if (!b.provider) throw new HttpError(400, "provider is required");
    cfg = { provider: b.provider, apiKey: b.apiKey ?? null, baseUrl: b.baseUrl ?? null };
  }
  try {
    return ok({ models: (await listModels(cfg, AbortSignal.timeout(15_000))).slice(0, 500) });
  } catch (e) {
    throw new HttpError(502, `Could not list models: ${(e as Error).message.slice(0, 160)}`, "model_list_failed");
  }
});
