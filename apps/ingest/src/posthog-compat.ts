/**
 * PostHog-compatible endpoint for migrations: `api_host: "https://<ingest>/ph"`.
 *
 * Capture requests (/e/, /i/v0/e/, /batch/, …) are decoded and written to the
 * project's HostPog native source. While the migration is in "parallel" mode
 * (forwarding = true) the original request is also forwarded byte-for-byte to
 * PostHog's capture host, and everything HostPog does not implement yet
 * (/flags, /s/ recordings, remote config, static assets) is reverse-proxied to
 * PostHog — the documented reverse-proxy pattern. After cutover (forwarding =
 * false) nothing is sent to PostHog; unsupported endpoints answer with safe
 * "disabled" responses so the SDK keeps working.
 *
 * Routing is by the PostHog project token, which HostPog verified belongs to the
 * connected PostHog project when the migration was set up.
 */
import { getDb, ingestionKeys, migrations, sources, type Db } from "@hostpog/db";
import { getClickHouse, ingestBatch, insertLogs, parseLogs, type DedupStore } from "@hostpog/native";
import { CaptureDecodeError, decodeCapture, isCapturePath, toHostPogEvent } from "@hostpog/posthog";
import { and, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { gunzipSync } from "node:zlib";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { Products } from "./products";

interface Route {
  /** null when the token is a HostPog project key (posthog-js used directly with HostPog, no migration) */
  migrationId: string | null;
  projectId: string;
  partitionId: string;
  captureHost: string;
  assetsHost: string;
  forwarding: boolean;
}

const HOP_BY_HOP = new Set(["connection", "keep-alive", "transfer-encoding", "content-length", "content-encoding", "host", "upgrade", "te", "trailer", "proxy-authorization", "proxy-authenticate"]);

/** Public CDN for posthog-js extension bundles (survey widget etc.). Only code is fetched from here, never data. */
const PUBLIC_ASSETS_HOST = "https://us-assets.i.posthog.com";

export async function registerPostHogCompat(app: FastifyInstance, opts: { dedup: DedupStore; fetchImpl?: typeof fetch; db?: Db; products?: Products }) {
  const db = opts.db ?? getDb();
  const ch = getClickHouse();
  const f = opts.fetchImpl ?? fetch;
  const cache = new Map<string, { route: Route | null; exp: number }>();
  const stats = new Map<string, { captured: number; forwarded: number; failures: number; lastError: string | null; lastSeen: Date | null }>();

  async function routeFor(token: string | null): Promise<Route | null> {
    if (!token || token.length > 200) return null;
    const c = cache.get(token);
    if (c && c.exp > Date.now()) return c.route;
    const rows = await db
      .select({ m: migrations, status: sources.status })
      .from(migrations)
      .innerJoin(sources, eq(sources.id, migrations.nativeSourceId))
      .where(and(eq(migrations.posthogProjectToken, token), isNotNull(migrations.posthogProjectToken)))
      .limit(1);
    const r = rows[0];
    let route: Route | null =
      r && r.status !== "disconnected"
        ? { migrationId: r.m.id, projectId: r.m.projectId, partitionId: r.m.nativeSourceId, captureHost: r.m.captureHost, assetsHost: r.m.assetsHost, forwarding: r.m.forwarding }
        : null;
    if (!route && /^hp_pk_[A-Za-z0-9_-]{16,64}$/.test(token)) {
      // posthog-js pointed straight at HostPog with a HostPog project key
      const [k] = await db
        .select({ projectId: ingestionKeys.projectId, sourceId: ingestionKeys.sourceId, status: sources.status })
        .from(ingestionKeys)
        .innerJoin(sources, eq(sources.id, ingestionKeys.sourceId))
        .where(and(eq(ingestionKeys.publicKey, token), isNull(ingestionKeys.revokedAt)))
        .limit(1);
      if (k && k.status !== "disconnected")
        route = { migrationId: null, projectId: k.projectId, partitionId: k.sourceId, captureHost: "", assetsHost: PUBLIC_ASSETS_HOST, forwarding: false };
    }
    cache.set(token, { route, exp: Date.now() + 10_000 });
    return route;
  }

  const stat = (id: string) => {
    let s = stats.get(id);
    if (!s) stats.set(id, (s = { captured: 0, forwarded: 0, failures: 0, lastError: null, lastSeen: null }));
    return s;
  };

  // Flush counters to Postgres so the web app can show forwarding health.
  const flush = async () => {
    for (const [id, s] of stats) {
      if (!s.captured && !s.forwarded && !s.failures) continue;
      const snap = { ...s };
      s.captured = s.forwarded = s.failures = 0;
      await db
        .update(migrations)
        .set({
          capturedViaProxy: sql`${migrations.capturedViaProxy} + ${snap.captured}`,
          forwardedRequests: sql`${migrations.forwardedRequests} + ${snap.forwarded}`,
          forwardFailures: sql`${migrations.forwardFailures} + ${snap.failures}`,
          ...(snap.lastError ? { lastForwardError: snap.lastError.slice(0, 300) } : {}),
          ...(snap.lastSeen ? { trackingLastSeenAt: snap.lastSeen, trackingFirstSeenAt: sql`coalesce(${migrations.trackingFirstSeenAt}, ${snap.lastSeen.toISOString()}::timestamptz)` } : {}),
          updatedAt: new Date(),
        })
        .where(eq(migrations.id, id))
        .catch((e) => console.error("[hostpog] forwarding stats flush failed", (e as Error).message, (e as { cause?: Error }).cause?.message));
    }
  };
  const timer = setInterval(() => void flush(), 5_000);
  timer.unref();
  app.addHook("onClose", async () => {
    clearInterval(timer);
    await flush();
  });

  function forwardHeaders(req: FastifyRequest): Record<string, string> {
    const h: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) {
      if (typeof v !== "string" || HOP_BY_HOP.has(k.toLowerCase()) || k.toLowerCase() === "cookie") continue;
      h[k] = v;
    }
    const xff = req.headers["x-forwarded-for"];
    h["x-forwarded-for"] = typeof xff === "string" && xff ? `${xff}, ${req.ip}` : req.ip;
    return h;
  }

  async function proxy(req: FastifyRequest, reply: FastifyReply, target: string, body: Buffer | undefined) {
    let res: Response;
    try {
      res = await f(target, {
      method: req.method,
      headers: forwardHeaders(req),
      body: body && body.length && req.method !== "GET" && req.method !== "HEAD" ? new Uint8Array(body) : undefined,
      redirect: "manual",
      signal: AbortSignal.timeout(10_000),
    });
    } catch (e) {
      req.log.warn({ target: new URL(target).host, err: (e as Error).message }, "posthog proxy failed");
      return reply.code(502).send({ detail: "Could not reach PostHog" });
    }
    reply.code(res.status);
    res.headers.forEach((v, k) => {
      if (!HOP_BY_HOP.has(k) && k !== "set-cookie" && !k.startsWith("access-control-")) reply.header(k, v);
    });
    return reply.send(Buffer.from(await res.arrayBuffer()));
  }

  /** GET/POST to PostHog and parse JSON; null on any failure (HostPog's own answer is still returned). */
  async function fetchJson(req: FastifyRequest, target: string, body: Buffer | undefined): Promise<Record<string, unknown> | null> {
    try {
      const r = await f(target, {
        method: body?.length ? "POST" : "GET",
        headers: forwardHeaders(req),
        body: body?.length ? new Uint8Array(body) : undefined,
        signal: AbortSignal.timeout(8_000),
      });
      if (!r.ok) return null;
      return (await r.json()) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  function tokenFromPath(path: string): string | null {
    return /^\/array\/([A-Za-z0-9_-]+)\//.exec(path)?.[1] ?? null;
  }

  await app.register(async (scope) => {
    // keep every body raw: we need the exact bytes to decode and to forward
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser("*", { parseAs: "buffer", bodyLimit: 20 * 1024 * 1024 }, (_req, body, done) => done(null, body));

    scope.all("/*", async (req, reply) => {
      const url = new URL(req.url, "http://local");
      const path = url.pathname.replace(/^\/ph/, "") || "/";
      const body = Buffer.isBuffer(req.body) ? req.body : undefined;

      if (isCapturePath(path) && req.method === "POST") {
        let decoded;
        try {
          decoded = decodeCapture(body ?? Buffer.alloc(0), req.headers["content-type"], url.searchParams);
        } catch (e) {
          if (e instanceof CaptureDecodeError) return reply.code(400).send({ type: "validation_error", detail: e.message });
          throw e;
        }
        const route = await routeFor(decoded.token);
        if (!route) return reply.code(401).send({ type: "authentication_error", detail: "Project token is not registered for a HostPog migration." });
        const now = new Date();
        const events = decoded.events.map((e) => toHostPogEvent(e, now)).filter((e) => e.event && e.distinct_id);
        // write to HostPog first: a failure returns 503 so the SDK retries (PostHog dedupes by uuid)
        const out = await ingestBatch(events, {
          db,
          ch,
          dedup: opts.dedup,
          partitionId: route.partitionId,
          sourceId: route.partitionId,
          onAccepted: (rows) => void opts.products?.onEvents(route.projectId, rows),
        });
        if (!route.migrationId) return reply.code(200).send({ status: "Ok", hostpog: { accepted: out.accepted, duplicates: out.duplicates, rejected: out.rejected.length } });
        const s = stat(route.migrationId);
        s.captured += out.accepted;
        s.lastSeen = now;
        if (route.forwarding) {
          try {
            const r = await f(`${route.captureHost}${path}${url.search}`, {
              method: "POST",
              headers: forwardHeaders(req),
              body: body ? new Uint8Array(body) : undefined,
              signal: AbortSignal.timeout(8_000),
            });
            if (r.ok) s.forwarded++;
            else {
              s.failures++;
              s.lastError = `PostHog answered ${r.status}`;
            }
          } catch (e) {
            s.failures++;
            s.lastError = (e as Error).message;
          }
        }
        return reply.code(200).send({ status: "Ok", hostpog: { accepted: out.accepted, duplicates: out.duplicates, rejected: out.rejected.length } });
      }

      // Everything else: proxy to PostHog while running in parallel, safe defaults after cutover.
      let token = tokenFromPath(path) ?? url.searchParams.get("token") ?? url.searchParams.get("api_key");
      if (!token && body?.length) {
        try {
          token = decodeCapture(body, req.headers["content-type"], url.searchParams).token;
        } catch {
          /* not a decodable body */
        }
      }
      const route = await routeFor(token);
      if (!route) return reply.code(404).send({ detail: "Unknown project token" });
      const products = opts.products;

      // Feature flags: HostPog's own flags, merged over PostHog's while the migration still forwards.
      if (products && (path.startsWith("/flags") || path.startsWith("/decide"))) {
        const reqBody = parseJsonBody(body, req.headers["content-type"], url.searchParams);
        const mine = await products.flags(route.projectId, route.partitionId, reqBody);
        let theirs: Record<string, unknown> = {};
        if (route.forwarding) theirs = (await fetchJson(req, `${route.captureHost}${path}${url.search}`, body)) ?? {};
        const theirFlags = normaliseFlags(theirs);
        const flags = { ...theirFlags, ...mine.flags };
        const legacy = Object.fromEntries(Object.entries(flags).map(([k, d]) => [k, d.variant ?? d.enabled]));
        const legacyPayloads = Object.fromEntries(Object.entries(flags).flatMap(([k, d]) => (d.metadata?.payload !== undefined ? [[k, d.metadata.payload]] : [])));
        return reply.send({
          ...theirs,
          flags,
          featureFlags: legacy,
          featureFlagPayloads: legacyPayloads,
          errorsWhileComputingFlags: Boolean(theirs.errorsWhileComputingFlags),
          requestId: mine.requestId,
          ...(path.startsWith("/decide") && !route.forwarding ? { sessionRecording: false, supportedCompression: ["gzip-js", "base64"], surveys: (await products.surveysFor(route.projectId)).length > 0 } : {}),
        });
      }

      // Logs (posthog-js logger / OTLP exporters): stored in HostPog; also forwarded while PostHog runs in parallel.
      if (path.startsWith("/i/v1/logs") && req.method === "POST") {
        const { rows, rejected } = parseLogs(parseJsonBody(body, req.headers["content-type"], url.searchParams), route.partitionId);
        await insertLogs(ch, rows);
        if (route.forwarding) void fetchJson(req, `${route.captureHost}${path}${url.search}`, body).catch(() => null);
        return reply.send({ status: "Ok", hostpog: { accepted: rows.length, rejected } });
      }

      // Surveys: served in posthog-js's format so its built-in survey widget renders them.
      if (products && path.startsWith("/api/surveys")) {
        const mine = await products.surveysFor(route.projectId);
        let theirs: unknown[] = [];
        if (route.forwarding) theirs = ((await fetchJson(req, `${route.captureHost}${path}${url.search}`, undefined))?.surveys as unknown[]) ?? [];
        return reply.send({ surveys: [...theirs, ...mine] });
      }

      // Remote config: tells posthog-js whether flags/surveys exist.
      const cfg = /^\/array\/[A-Za-z0-9_-]+\/config$/.test(path);
      if (products && cfg) {
        const mine = await products.remoteConfig(route.projectId, token!);
        if (route.forwarding) {
          const theirs = (await fetchJson(req, `${route.assetsHost}${path}${url.search}`, undefined)) ?? {};
          return reply.send({ ...mine, ...theirs, hasFeatureFlags: Boolean(theirs.hasFeatureFlags) || mine.hasFeatureFlags, surveys: Boolean(theirs.surveys) || mine.surveys });
        }
        return reply.send(mine);
      }

      if (route.forwarding) {
        const host = path.startsWith("/static/") || path.startsWith("/array/") ? route.assetsHost : route.captureHost;
        return proxy(req, reply, `${host}${path}${url.search}`, body);
      }
      if (path.startsWith("/flags") || path.startsWith("/decide")) {
        return reply.send({ flags: {}, featureFlags: {}, featureFlagPayloads: {}, errorsWhileComputingFlags: false, sessionRecording: false, supportedCompression: ["gzip-js", "base64"] });
      }
      if (path.startsWith("/s/") || path.startsWith("/i/v0/s")) return reply.code(200).send({ status: "Ok", stored: false });
      // posthog-js extension bundles (survey widget): public code, safe to fetch from PostHog's CDN after cutover.
      if (path.startsWith("/static/")) return proxy(req, reply, `${PUBLIC_ASSETS_HOST}${path}${url.search}`, undefined);
      return reply.code(404).send({ detail: "Not available after cutover from PostHog" });
    });
  }, { prefix: "/ph" });
}

type FlagDetail = { key: string; enabled: boolean; variant?: string; metadata?: { payload?: string } };

/** PostHog answers /flags (v2: flags{}) or /decide (featureFlags{}); normalise both to v2 details. */
function normaliseFlags(r: Record<string, unknown>): Record<string, FlagDetail> {
  if (r.flags && typeof r.flags === "object") return r.flags as Record<string, FlagDetail>;
  const ff = (r.featureFlags ?? {}) as Record<string, boolean | string>;
  const payloads = (r.featureFlagPayloads ?? {}) as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(ff).map(([k, v]) => [
      k,
      { key: k, enabled: typeof v === "string" ? true : Boolean(v), variant: typeof v === "string" ? v : undefined, metadata: payloads[k] !== undefined ? { payload: typeof payloads[k] === "string" ? (payloads[k] as string) : JSON.stringify(payloads[k]) } : undefined },
    ]),
  );
}

/** Flag request bodies are JSON, optionally gzip-compressed or base64 form-encoded (data=...). */
function parseJsonBody(body: Buffer | undefined, contentType: string | undefined, query: URLSearchParams): Record<string, unknown> {
  if (!body?.length) return {};
  const tryJson = (b: Buffer | string) => {
    try {
      const v = JSON.parse(typeof b === "string" ? b : b.toString("utf8"));
      return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };
  let buf = body;
  if (buf[0] === 0x1f && buf[1] === 0x8b) {
    try {
      buf = gunzipSync(buf);
    } catch {
      return {};
    }
  }
  const direct = tryJson(buf);
  if (direct) return direct;
  const form = new URLSearchParams(buf.toString("utf8")).get("data") ?? (contentType?.includes("form") ? null : null);
  if (form) return tryJson(Buffer.from(form, "base64")) ?? tryJson(form) ?? {};
  void query;
  return {};
}

/** used by tests */
export async function countRoutes(db: Db) {
  return db.select().from(migrations).where(ne(migrations.status, "rolled_back"));
}
