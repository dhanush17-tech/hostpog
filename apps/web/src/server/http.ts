import "server-only";
import { ProviderError } from "@hostpog/analytics";
import { NextResponse } from "next/server";
import { ZodError, type ZodType } from "zod";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = "error",
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

const PROVIDER_STATUS: Record<string, number> = {
  unauthorized: 424, // upstream credential problem, not the HostPog session
  forbidden: 424,
  not_found: 404,
  rate_limited: 429,
  budget_exhausted: 429,
  timeout: 504,
  cancelled: 499,
  upstream: 502,
  bad_query: 400,
  unsupported: 422,
};

export function errorResponse(e: unknown): NextResponse {
  if (e instanceof HttpError) return NextResponse.json({ error: { code: e.code, message: e.message, ...e.extra } }, { status: e.status });
  if (e instanceof ZodError) {
    return NextResponse.json({ error: { code: "invalid_request", message: "Invalid request", issues: e.issues.slice(0, 10) } }, { status: 400 });
  }
  if (e instanceof ProviderError) {
    return NextResponse.json(
      { error: { code: `provider_${e.code}`, message: e.message, retryAfterSeconds: e.retryAfterSeconds, missingScope: e.missingScope } },
      { status: PROVIDER_STATUS[e.code] ?? 502, headers: e.retryAfterSeconds ? { "Retry-After": String(e.retryAfterSeconds) } : undefined },
    );
  }
  if (e instanceof Error && /date range|invalid date/.test(e.message)) {
    return NextResponse.json({ error: { code: "invalid_range", message: e.message } }, { status: 400 });
  }
  // Postgres "undefined table/column": the code is newer than the database. Say how to fix it instead of a blank 500.
  const pgCode = (e as { code?: string; cause?: { code?: string } } | null)?.code ?? (e as { cause?: { code?: string } } | null)?.cause?.code;
  if (pgCode === "42P01" || pgCode === "42703") {
    console.error("[hostpog] database schema is out of date:", e instanceof Error ? e.message : e);
    return NextResponse.json(
      { error: { code: "schema_outdated", message: "The database is behind this version of HostPog. Run `pnpm db:migrate` (self-hosted: `./hostpog update`), then reload." } },
      { status: 503 },
    );
  }
  console.error("[hostpog] unhandled", e instanceof Error ? e.message : e);
  return NextResponse.json({ error: { code: "internal", message: "Something went wrong" } }, { status: 500 });
}

/** Wrap a route handler: maps typed errors to JSON responses, never leaks stack traces. */
export function route<C>(fn: (req: Request, ctx: C) => Promise<Response>) {
  return async (req: Request, ctx: C) => {
    try {
      return await fn(req, ctx);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export async function body<T>(req: Request, schema: ZodType<T>): Promise<T> {
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("application/json")) throw new HttpError(415, "Content-Type must be application/json");
  const text = await req.text();
  if (text.length > 256_000) throw new HttpError(413, "Request body too large");
  let raw: unknown;
  try {
    raw = text ? JSON.parse(text) : {};
  } catch {
    throw new HttpError(400, "Malformed JSON");
  }
  return schema.parse(raw);
}

export const ok = (data: unknown, init?: ResponseInit) => NextResponse.json(data, init);
