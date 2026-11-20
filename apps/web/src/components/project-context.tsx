"use client";
import type { Role } from "@hostpog/contracts";
import { useQuery } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { apiGet } from "@/lib/api";

export interface SourceInfo {
  id: string;
  kind: "posthog" | "native" | "imported" | "demo";
  label: string;
  status: "active" | "error" | "disconnected";
  config: Record<string, unknown>;
  createdAt: string;
  lastSuccessAt: string | null;
  lastError: string | null;
  credential: { id: string; hint: string; kind: string; createdAt: string; rotatedAt: string | null; expiresAt: string | null } | null;
  stats: { ok: number; errors: number; rateLimited: number; last: string | null };
  ingestionKeys: { id: string; publicKey: string; allowedOrigins: string[]; createdAt: string }[];
}

export interface ProjectCtx {
  projectId: string;
  projectName: string;
  timezone: string;
  workspaceId: string;
  workspaceName: string;
  role: Role;
  sources: SourceInfo[];
  sourcesLoading: boolean;
  primarySourceId: string | null;
  /** the single source answering queries on this page */
  source: SourceInfo | null;
  sourceId: string | null;
  setSourceId: (id: string) => void;
  range: string;
  setRange: (r: string) => void;
  can: (min: Role) => boolean;
  href: (path: string) => string;
}

const Ctx = createContext<ProjectCtx | null>(null);
const RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };

export function ProjectProvider(props: { projectId: string; projectName: string; timezone: string; workspaceId: string; workspaceName: string; role: Role; children: ReactNode }) {
  const sp = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const q = useQuery({
    queryKey: ["sources", props.projectId],
    queryFn: () => apiGet<{ primarySourceId: string | null; sources: SourceInfo[] }>(`/api/v1/projects/${props.projectId}/sources`),
  });
  const sources = q.data?.sources ?? [];
  const requested = sp.get("source");
  const source =
    sources.find((s) => s.id === requested) ?? sources.find((s) => s.id === q.data?.primarySourceId) ?? sources.find((s) => s.kind !== "demo") ?? sources[0] ?? null;
  const range = sp.get("range") ?? "-7d";

  const setParam = useCallback(
    (k: string, v: string) => {
      const next = new URLSearchParams(sp.toString());
      next.set(k, v);
      router.replace(`${pathname}?${next.toString()}`, { scroll: false });
    },
    [sp, router, pathname],
  );

  const value = useMemo<ProjectCtx>(
    () => ({
      ...props,
      sources,
      sourcesLoading: q.isLoading,
      primarySourceId: q.data?.primarySourceId ?? null,
      source,
      sourceId: source?.id ?? null,
      setSourceId: (id) => setParam("source", id),
      range,
      setRange: (r) => setParam("range", r),
      can: (min) => RANK[props.role] >= RANK[min],
      href: (path) => {
        const keep = new URLSearchParams();
        if (sp.get("source")) keep.set("source", sp.get("source")!);
        if (sp.get("range")) keep.set("range", sp.get("range")!);
        const qs = keep.toString();
        return `/app/p/${props.projectId}/${path}${qs ? `?${qs}` : ""}`;
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.projectId, props.role, props.timezone, props.projectName, sources, q.isLoading, q.data?.primarySourceId, source, range, setParam, sp],
  );
  return <Ctx.Provider value={value}>{props.children}</Ctx.Provider>;
}

export function useProject(): ProjectCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error("useProject outside ProjectProvider");
  return c;
}
