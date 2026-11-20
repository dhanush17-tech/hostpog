/**
 * Decoding of PostHog capture requests, so existing PostHog SDKs can point
 * `api_host` at HostPog during a migration.
 *
 * Verified against posthog-js 1.451.1 (dist/module.js):
 *  - compression "gzip-js": body is gzip bytes, query `?compression=gzip-js`
 *  - compression "base64": form body `data=<urlencoded base64(UTF-8 JSON)>`
 *  - legacy "lz64": LZString.compressToBase64 (older SDKs)
 *  - payload: a single event, an array of events, or { api_key|token, batch: [...], sent_at }
 * Server SDKs (posthog-node, posthog-python) POST JSON { api_key, batch } to /batch/ with
 * `distinct_id` at the top level of each event.
 */
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import LZString from "lz-string";

export const CAPTURE_PATHS = ["/e/", "/e", "/i/v0/e/", "/i/v0/e", "/batch/", "/batch", "/capture/", "/capture", "/track/", "/track", "/engage/", "/engage"];

export function isCapturePath(path: string): boolean {
  return CAPTURE_PATHS.includes(path);
}

export interface DecodedCapture {
  token: string | null;
  events: Record<string, unknown>[];
  encoding: "json" | "gzip-js" | "base64" | "lz64" | "form-json";
}

export class CaptureDecodeError extends Error {}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    throw new CaptureDecodeError("payload is not valid JSON");
  }
}

function b64Json(s: string): unknown {
  const text = Buffer.from(s.replace(/ /g, "+"), "base64").toString("utf8");
  return parseJson(text);
}

/** Decode a raw capture request body. `query` is the request's URLSearchParams. */
export function decodeCapture(raw: Buffer, contentType: string | undefined, query: URLSearchParams): DecodedCapture {
  const compression = query.get("compression") ?? "";
  let payload: unknown;
  let encoding: DecodedCapture["encoding"] = "json";

  const isGzip = raw.length > 2 && raw[0] === 0x1f && raw[1] === 0x8b;
  if (compression === "gzip-js" || compression === "gzip" || isGzip) {
    try {
      payload = parseJson(gunzipSync(raw).toString("utf8"));
    } catch (e) {
      throw e instanceof CaptureDecodeError ? e : new CaptureDecodeError("invalid gzip body");
    }
    encoding = "gzip-js";
  } else {
    const text = raw.toString("utf8");
    const formLike = (contentType ?? "").includes("application/x-www-form-urlencoded") || text.startsWith("data=");
    if (formLike) {
      const form = new URLSearchParams(text);
      const data = form.get("data") ?? "";
      if (compression === "lz64") {
        const s = LZString.decompressFromBase64(data);
        if (!s) throw new CaptureDecodeError("invalid lz64 body");
        payload = parseJson(s);
        encoding = "lz64";
      } else if (data.trimStart().startsWith("{") || data.trimStart().startsWith("[")) {
        payload = parseJson(data);
        encoding = "form-json";
      } else {
        payload = b64Json(data);
        encoding = "base64";
      }
    } else if (compression === "base64") {
      payload = b64Json(text);
      encoding = "base64";
    } else {
      payload = parseJson(text);
    }
  }

  let events: unknown[];
  let token: string | null = query.get("token") ?? query.get("api_key");
  if (Array.isArray(payload)) {
    events = payload;
  } else if (payload && typeof payload === "object" && Array.isArray((payload as { batch?: unknown }).batch)) {
    const p = payload as { batch: unknown[]; api_key?: string; token?: string };
    events = p.batch;
    token = p.api_key ?? p.token ?? token;
  } else if (payload && typeof payload === "object") {
    events = [payload];
  } else {
    throw new CaptureDecodeError("unsupported payload shape");
  }
  const objs = events.filter((e): e is Record<string, unknown> => Boolean(e) && typeof e === "object" && !Array.isArray(e));
  for (const e of objs) {
    const props = (e.properties ?? {}) as Record<string, unknown>;
    token ??= (e.api_key as string) ?? (e.token as string) ?? (props.token as string) ?? null;
    if (token) break;
  }
  return { token: typeof token === "string" ? token : null, events: objs, encoding };
}

function uuidFromHash(input: string): string {
  const h = createHash("sha256").update(input).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Convert a PostHog event into HostPog's ingest shape. Missing uuids are derived
 * deterministically so a retried request maps to the same event.
 */
export function toHostPogEvent(e: Record<string, unknown>, receivedAt: Date): Record<string, unknown> {
  const props = { ...((e.properties as Record<string, unknown>) ?? {}) };
  const distinctId = String(e.distinct_id ?? props.distinct_id ?? props.$device_id ?? "");
  delete props.token;
  delete props.distinct_id;
  let ts: Date | null = null;
  if (typeof e.timestamp === "string" || typeof e.timestamp === "number") ts = new Date(e.timestamp);
  if ((!ts || Number.isNaN(ts.getTime())) && typeof e.offset === "number") {
    const sentAt = typeof e.sent_at === "string" ? new Date(e.sent_at) : receivedAt;
    ts = new Date(sentAt.getTime() - e.offset);
  }
  if (!ts || Number.isNaN(ts.getTime())) ts = receivedAt;
  // $set/$set_once can arrive top-level from server SDKs
  if (e.$set && !props.$set) props.$set = e.$set;
  if (e.$set_once && !props.$set_once) props.$set_once = e.$set_once;
  const event = String(e.event ?? "");
  const uuid =
    typeof e.uuid === "string" && UUID.test(e.uuid)
      ? e.uuid.toLowerCase()
      : uuidFromHash(JSON.stringify([distinctId, event, ts.toISOString(), props.$session_id ?? null, props.$insert_id ?? null]));
  return { uuid, event, distinct_id: distinctId, timestamp: ts.toISOString(), properties: props };
}

export function captureHostsFor(region: "us" | "eu" | "self_hosted", selfHostedHost?: string) {
  if (region === "us") return { captureHost: "https://us.i.posthog.com", assetsHost: "https://us-assets.i.posthog.com" };
  if (region === "eu") return { captureHost: "https://eu.i.posthog.com", assetsHost: "https://eu-assets.i.posthog.com" };
  return { captureHost: selfHostedHost!, assetsHost: selfHostedHost! };
}
