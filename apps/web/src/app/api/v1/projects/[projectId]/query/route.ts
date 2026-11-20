import { AnalyticsQuery } from "@hostpog/contracts";
import { ProviderError } from "@hostpog/analytics";
import { z } from "zod";
import { requireProject } from "@/server/authz";
import { body, ok, route } from "@/server/http";
import { markSourceResult, providerFor, resolveSource } from "@/server/sources";

type Ctx = { params: Promise<{ projectId: string }> };

const Input = z.object({ sourceId: z.string().uuid().nullish(), query: AnalyticsQuery });

/** Run one metric-DSL query against exactly one source. Response is a provenance envelope. */
export const POST = route<Ctx>(async (req, { params }) => {
  const { projectId } = await params;
  const a = await requireProject(projectId, "viewer", req);
  const b = await body(req, Input);
  const src = await resolveSource(a, b.sourceId);
  const provider = await providerFor(a, src);
  try {
    const env = await provider.query(b.query, { signal: req.signal });
    if (src.kind === "posthog" && !env.cached) void markSourceResult(src.id, null);
    return ok(env);
  } catch (e) {
    if (e instanceof ProviderError && (e.code === "unauthorized" || e.code === "forbidden")) void markSourceResult(src.id, e.message);
    throw e;
  }
});
