import { allowedPrivateHosts } from "@hostpog/ai";
import { requireWorkspace } from "@/server/authz";
import { ok, route } from "@/server/http";

type Ctx = { params: Promise<{ workspaceId: string }> };

// Fixed, well-known Ollama addresses only — this endpoint never takes a URL from the request.
const CANDIDATES = ["http://localhost:11434", "http://127.0.0.1:11434", "http://host.docker.internal:11434"];

/** Detects a local Ollama next to this hostpog server (self-hosted installs). Hosted deployments simply find nothing. */
export const GET = route<Ctx>(async (_req, { params }) => {
  const { workspaceId } = await params;
  await requireWorkspace(workspaceId, "admin");
  for (const base of CANDIDATES) {
    try {
      const res = await fetch(`${base}/api/tags`, { signal: AbortSignal.timeout(800), redirect: "error" });
      if (!res.ok) continue;
      const j = (await res.json()) as { models?: { name: string }[] };
      const host = new URL(base).hostname;
      return ok({ detected: true, baseUrl: `${base}/v1`, models: (j.models ?? []).map((m) => m.name).slice(0, 100), allowed: allowedPrivateHosts().has(host), host });
    } catch {
      // not running here
    }
  }
  return ok({ detected: false });
});
