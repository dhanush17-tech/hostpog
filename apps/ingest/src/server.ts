/**
 * HostPog native ingestion service.
 *
 * - Write-only public project keys (hp_pk_…): they can only append events to
 *   their own project. They never authorize reads or admin operations.
 * - Acknowledges (200) only after the batch is durably written to ClickHouse.
 * - At-least-once friendly: duplicate uuids are accepted and ignored.
 */
import { internalAuthOk, seedDemo, startJobWorker } from "./worker";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import { IngestBatch, MAX_BATCH_BYTES } from "@hostpog/contracts";
import { getDb, ingestionKeys, sources } from "@hostpog/db";
import { getClickHouse, ingestBatch, insertLogs, MemoryDedupStore, parseLogs, type DedupStore } from "@hostpog/native";
import { and, eq, isNull } from "drizzle-orm";
import Fastify, { type FastifyRequest } from "fastify";
import { Redis } from "ioredis";
import { randomUUID } from "node:crypto";
import { registerPostHogCompat } from "./posthog-compat";
import { createProducts } from "./products";
import { startTelemetry } from "./telemetry";
import { startWorkflowDelivery } from "./workflow-delivery";

interface KeyInfo {
  projectId: string;
  sourceId: string;
  allowedOrigins: string[];
}

export function redisDedup(redis: Redis): DedupStore {
  return {
    async claim(key, ttl) {
      return (await redis.set(key, "1", "EX", ttl, "NX")) === "OK";
    },
    async release(key) {
      await redis.del(key);
    },
  };
}

export async function buildServer(opts: { redis?: Redis | null; logger?: boolean; fetchImpl?: typeof fetch } = {}) {
  const app = Fastify({
    logger: opts.logger ?? true,
    bodyLimit: MAX_BATCH_BYTES,
    genReqId: () => randomUUID(),
    trustProxy: process.env.HOSTPOG_TRUST_PROXY === "true",
  });
  const db = getDb();
  const ch = getClickHouse();
  const dedup = opts.redis ? redisDedup(opts.redis) : new MemoryDedupStore();
  const keyCache = new Map<string, { info: KeyInfo | null; exp: number }>();
  const products = createProducts(db);

  async function resolveKey(key: string | undefined): Promise<KeyInfo | null> {
    if (!key || !/^hp_pk_[A-Za-z0-9_-]{16,64}$/.test(key)) return null;
    const c = keyCache.get(key);
    if (c && c.exp > Date.now()) return c.info;
    const rows = await db
      .select({ projectId: ingestionKeys.projectId, sourceId: ingestionKeys.sourceId, allowedOrigins: ingestionKeys.allowedOrigins, status: sources.status })
      .from(ingestionKeys)
      .innerJoin(sources, eq(sources.id, ingestionKeys.sourceId))
      .where(and(eq(ingestionKeys.publicKey, key), isNull(ingestionKeys.revokedAt)))
      .limit(1);
    const r = rows[0];
    const info = r && r.status !== "disconnected" ? { projectId: r.projectId, sourceId: r.sourceId, allowedOrigins: r.allowedOrigins } : null;
    keyCache.set(key, { info, exp: Date.now() + 30_000 });
    return info;
  }

  function keyFrom(req: FastifyRequest): string | undefined {
    const auth = req.headers.authorization;
    if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();
    const b = req.body as { api_key?: string } | undefined;
    return b?.api_key ?? (req.query as { api_key?: string } | undefined)?.api_key;
  }

  // Browsers need CORS; the origin check per key happens in the handler.
  await app.register(cors, { origin: true, methods: ["POST", "OPTIONS"], maxAge: 86400 });
  await app.register(rateLimit, {
    max: Number(process.env.HOSTPOG_INGEST_RATE_PER_MINUTE ?? 1200),
    timeWindow: "1 minute",
    keyGenerator: (req) => keyFrom(req) ?? req.ip,
    ...(opts.redis ? { redis: opts.redis } : {}),
  });

  app.get("/health", async () => {
    await ch.ping();
    return { ok: true, service: "hostpog-ingest" };
  });

  const handle = async (req: FastifyRequest, single: boolean) => {
    const info = await resolveKey(keyFrom(req));
    if (!info) return { status: 401, body: { error: "invalid or revoked project key" } };
    const origin = req.headers.origin;
    if (origin && info.allowedOrigins.length && !info.allowedOrigins.includes(origin)) {
      return { status: 403, body: { error: "origin not allowed for this project key" } };
    }
    let events: unknown[];
    if (single) {
      events = [req.body];
    } else {
      const parsed = IngestBatch.safeParse(req.body);
      if (!parsed.success) return { status: 400, body: { error: "invalid batch", issues: parsed.error.issues.slice(0, 5) } };
      events = parsed.data.batch;
    }
    const out = await ingestBatch(events, {
      db,
      ch,
      dedup,
      partitionId: info.sourceId,
      sourceId: info.sourceId,
      onAccepted: (rows) => void products.onEvents(info.projectId, rows),
    });
    return { status: 200, body: { status: "ok", accepted: out.accepted, duplicates: out.duplicates, rejected: out.rejected, warnings: out.warnings.slice(0, 20) } };
  };

  // Web → ingest: seed sample data next to the database (hosted mode). Token-protected, not for SDKs.
  app.post("/internal/demo", async (req, reply) => {
    if (!internalAuthOk(req.headers.authorization)) return reply.code(401).send({ error: "unauthorized" });
    const sourceId = (req.body as { sourceId?: unknown } | null)?.sourceId;
    if (typeof sourceId !== "string" || !/^[0-9a-f-]{36}$/i.test(sourceId)) return reply.code(400).send({ error: "sourceId required" });
    const events = await seedDemo(sourceId);
    return { ok: true, events };
  });

  app.post("/v1/batch", async (req, reply) => {
    const r = await handle(req, false);
    return reply.code(r.status).send(r.body);
  });
  app.post("/v1/capture", async (req, reply) => {
    const r = await handle(req, true);
    return reply.code(r.status).send(r.body);
  });

  // Feature flags for the HostPog SDK (posthog-js uses /ph/flags). Body: { distinct_id, person_properties? }
  app.post("/v1/flags", async (req, reply) => {
    const info = await resolveKey(keyFrom(req));
    if (!info) return reply.code(401).send({ error: "invalid or revoked project key" });
    const b = (req.body ?? {}) as { distinct_id?: unknown; person_properties?: unknown; flag_keys?: unknown };
    if (typeof b.distinct_id !== "string" || !b.distinct_id) return reply.code(400).send({ error: "distinct_id required" });
    const r = await products.flags(info.projectId, info.sourceId, b);
    const flags = Object.fromEntries(Object.entries(r.flags).map(([k, d]) => [k, d.variant ?? d.enabled]));
    const payloads = Object.fromEntries(Object.entries(r.flags).flatMap(([k, d]) => (d.metadata.payload !== undefined ? [[k, JSON.parse(d.metadata.payload)]] : [])));
    return { flags, payloads };
  });

  // Logs: OTLP/HTTP JSON ({ resourceLogs }) or { logs: [{ message, level, service, attributes, ... }] }
  app.post("/v1/logs", async (req, reply) => {
    const info = await resolveKey(keyFrom(req));
    if (!info) return reply.code(401).send({ error: "invalid or revoked project key" });
    const { rows, rejected } = parseLogs(req.body, info.sourceId);
    await insertLogs(ch, rows);
    return { status: "ok", accepted: rows.length, rejected };
  });

  await registerPostHogCompat(app, { dedup, fetchImpl: opts.fetchImpl, products });

  app.setErrorHandler((err, req, reply) => {
    const e = err as { statusCode?: number; message: string };
    req.log.error({ err: e.message }, "ingest error");
    const status = e.statusCode && e.statusCode < 500 ? e.statusCode : 503;
    // 503 tells SDKs to retry; the batch was not acknowledged
    reply.code(status).send({ error: status === 503 ? "temporarily unavailable, retry" : e.message, requestId: req.id });
  });

  return app;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const redis = process.env.REDIS_URL ? new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: 2 }) : null;
  const app = await buildServer({ redis });
  await app.listen({ port: Number(process.env.INGEST_PORT ?? 3001), host: process.env.INGEST_HOST ?? "0.0.0.0" });
  const stopDelivery = process.env.HOSTPOG_WORKFLOWS_DISABLED === "true" ? () => {} : startWorkflowDelivery(app.log);
  const stopJobs = process.env.HOSTPOG_JOB_RUNNER === "worker" ? startJobWorker(app.log) : null;
  if (stopJobs) app.log.info("job worker started");
  const stopTelemetry = startTelemetry(app.log);
  const shutdown = async () => {
    stopDelivery();
    stopTelemetry();
    await stopJobs?.();
    await app.close();
    process.exit(0);
  };
  process.once("SIGTERM", () => void shutdown());
  process.once("SIGINT", () => void shutdown());
}
