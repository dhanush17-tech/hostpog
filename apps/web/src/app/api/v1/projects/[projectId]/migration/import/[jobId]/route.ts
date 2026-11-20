import { getDb, importJobs, migrations } from "@hostpog/db";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireProject } from "@/server/authz";
import { body, HttpError, ok, route } from "@/server/http";
import { cancelJob, isJobRunning, resumeImport } from "@/server/migration";

type Ctx = { params: Promise<{ projectId: string; jobId: string }> };

async function load(projectId: string, jobId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(jobId)) throw new HttpError(404, "Import not found");
  const rows = await getDb()
    .select({ job: importJobs })
    .from(importJobs)
    .innerJoin(migrations, eq(migrations.id, importJobs.migrationId))
    .where(and(eq(importJobs.id, jobId), eq(migrations.projectId, projectId)))
    .limit(1);
  if (!rows[0]) throw new HttpError(404, "Import not found");
  return rows[0].job;
}

export const GET = route<Ctx>(async (_req, { params }) => {
  const { projectId, jobId } = await params;
  await requireProject(projectId);
  const job = await load(projectId, jobId);
  return ok({ job: { ...job, running: isJobRunning(job) } });
});

export const POST = route<Ctx>(async (req, { params }) => {
  const { projectId, jobId } = await params;
  const a = await requireProject(projectId, "admin", req);
  const b = await body(req, z.object({ action: z.enum(["cancel", "resume"]) }));
  const job = await load(projectId, jobId);
  if (b.action === "cancel") {
    await cancelJob(job);
    return ok({ cancelled: true });
  }
  return ok({ job: await resumeImport(a, job.id) });
});
