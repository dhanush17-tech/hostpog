import { normalizeEndpoint, PROVIDER_INFO } from "@hostpog/ai";
import { aiProviders, credentials, getDb, secretHint } from "@hostpog/db";
import { desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { audit } from "@/server/audit";
import { publicProvider } from "@/server/ai";
import { requireWorkspace } from "@/server/authz";
import { body, HttpError, ok, route } from "@/server/http";
import { storeSecret } from "@/server/sources";

type Ctx = { params: Promise<{ workspaceId: string }> };

export const GET = route<Ctx>(async (_req, { params }) => {
  const { workspaceId } = await params;
  await requireWorkspace(workspaceId);
  const db = getDb();
  const rows = await db.select().from(aiProviders).where(eq(aiProviders.workspaceId, workspaceId)).orderBy(desc(aiProviders.createdAt));
  const ids = rows.map((r) => r.credentialId).filter((x): x is string => Boolean(x));
  const hints = ids.length ? await db.select({ id: credentials.id, hint: credentials.hint }).from(credentials).where(inArray(credentials.id, ids)) : [];
  return ok({
    providers: rows.map((r) => publicProvider(r, hints.find((h) => h.id === r.credentialId)?.hint ?? null)),
    catalog: Object.entries(PROVIDER_INFO).map(([id, v]) => ({ id, ...v })),
  });
});

const Input = z.object({
  provider: z.enum(["openai", "anthropic", "google", "openrouter", "openai_compatible"]),
  label: z.string().min(1).max(80),
  model: z.string().min(1).max(200),
  apiKey: z.string().max(500).optional(),
  baseUrl: z.string().max(500).optional(),
  monthlyTokenBudget: z.number().int().min(1000).max(1_000_000_000).default(2_000_000),
  allowRawEvents: z.boolean().default(false),
});

export const POST = route<Ctx>(async (req, { params }) => {
  const { workspaceId } = await params;
  const a = await requireWorkspace(workspaceId, "admin", req);
  const b = await body(req, Input);
  if (b.provider === "openai_compatible" && !b.baseUrl) throw new HttpError(400, "An endpoint URL is required");
  if (b.provider !== "openai_compatible" && !b.apiKey) throw new HttpError(400, "An API key is required");
  if (b.baseUrl) {
    try {
      normalizeEndpoint(b.baseUrl);
    } catch (e) {
      throw new HttpError(400, (e as Error).message, "endpoint_policy");
    }
  }
  const db = getDb();
  let credentialId: string | null = null;
  if (b.apiKey) {
    const enc = storeSecret(workspaceId, "ai_api_key", b.apiKey.trim());
    const [c] = await db
      .insert(credentials)
      .values({ workspaceId, kind: "ai_api_key", ciphertext: enc.ciphertext, keyVersion: enc.keyVersion, hint: secretHint(b.apiKey.trim()) })
      .returning({ id: credentials.id });
    credentialId = c!.id;
  }
  const [p] = await db
    .insert(aiProviders)
    .values({
      workspaceId,
      provider: b.provider,
      label: b.label,
      model: b.model.trim(),
      baseUrl: b.baseUrl?.trim() || null,
      credentialId,
      monthlyTokenBudget: b.monthlyTokenBudget,
      allowRawEvents: b.allowRawEvents,
    })
    .returning();
  await audit({ workspaceId, actorUserId: a.user.id, action: "ai_provider.create", target: p!.id, meta: { provider: b.provider, model: b.model }, req });
  return ok({ provider: publicProvider(p!, b.apiKey ? secretHint(b.apiKey) : null) }, { status: 201 });
});
