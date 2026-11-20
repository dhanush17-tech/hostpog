"use client";
import type { AnalyticsQuery, Envelope, ResultFor } from "@hostpog/contracts";
import { useQuery, type UseQueryOptions } from "@tanstack/react-query";

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let j: unknown = null;
  try {
    j = text ? JSON.parse(text) : null;
  } catch {
    if (!res.ok) throw new ApiError(res.status, "http", text.slice(0, 200) || res.statusText);
    return text as T;
  }
  if (!res.ok) {
    const e = (j as { error?: { code?: string; message?: string } } | null)?.error;
    throw new ApiError(res.status, e?.code ?? "http", e?.message ?? res.statusText, (j as { error?: Record<string, unknown> })?.error ?? {});
  }
  return j as T;
}

export async function apiGet<T>(path: string, signal?: AbortSignal): Promise<T> {
  return parse<T>(await fetch(path, { credentials: "same-origin", signal, headers: { accept: "application/json" } }));
}

export async function apiSend<T>(path: string, method: "POST" | "PATCH" | "DELETE", body?: unknown): Promise<T> {
  return parse<T>(
    await fetch(path, {
      method,
      credentials: "same-origin",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

export async function apiText(path: string): Promise<string> {
  const res = await fetch(path, { credentials: "same-origin" });
  if (!res.ok) throw new ApiError(res.status, "http", await res.text());
  return res.text();
}

export function useAnalytics<Q extends AnalyticsQuery>(
  projectId: string,
  sourceId: string | null,
  query: Q | null,
  opts: Partial<UseQueryOptions<Envelope<ResultFor<Q>>, ApiError>> = {},
) {
  return useQuery<Envelope<ResultFor<Q>>, ApiError>({
    queryKey: ["analytics", projectId, sourceId, query],
    queryFn: ({ signal }) =>
      fetch(`/api/v1/projects/${projectId}/query`, {
        method: "POST",
        credentials: "same-origin",
        signal,
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceId, query }),
      }).then((r) => parse<Envelope<ResultFor<Q>>>(r)),
    enabled: Boolean(query) && (opts.enabled ?? true),
    staleTime: 30_000,
    retry: (n, e) => n < 1 && (e.status >= 500 || e.status === 0),
    ...opts,
  });
}
