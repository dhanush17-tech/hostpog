import { requireProject } from "@/server/authz";
import { HttpError, ok, route } from "@/server/http";
import { importExportFile } from "@/server/migration";

type Ctx = { params: Promise<{ projectId: string }> };

const MAX_BYTES = Number(process.env.HOSTPOG_UPLOAD_MAX_BYTES ?? 200 * 1024 * 1024);

/**
 * Upload one PostHog batch-export file (JSON lines, .jsonl or .jsonl.gz) as the raw request body.
 * Header X-Filename carries the original name. Idempotent: re-uploading the same file adds nothing.
 */
export const POST = route<Ctx>(async (req, { params }) => {
  const { projectId } = await params;
  const a = await requireProject(projectId, "admin", req);
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_BYTES) throw new HttpError(413, `File too large (max ${Math.round(MAX_BYTES / 1024 / 1024)} MB per upload).`);
  const bytes = Buffer.from(await req.arrayBuffer());
  if (!bytes.length) throw new HttpError(400, "Empty file");
  if (bytes.length > MAX_BYTES) throw new HttpError(413, "File too large");
  const name = (req.headers.get("x-filename") ?? "export.jsonl").slice(0, 200);
  return ok({ job: await importExportFile(a, req, { name, bytes }) }, { status: 201 });
});
