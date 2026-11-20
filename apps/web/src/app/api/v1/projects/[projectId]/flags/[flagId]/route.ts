import { z } from "zod";
import { requireProject } from "@/server/authz";
import { body, ok, route } from "@/server/http";
import { deleteFlag, FlagCondition, FlagVariant, getFlag, updateFlag } from "@/server/products";

type Ctx = { params: Promise<{ projectId: string; flagId: string }> };
const Patch = z.object({
  key: z.string().optional(),
  name: z.string().max(200).optional(),
  active: z.boolean().optional(),
  rolloutPercent: z.number().int().min(0).max(100).optional(),
  conditions: z.array(FlagCondition).max(20).optional(),
  variants: z.array(FlagVariant).max(10).optional(),
  payloads: z.record(z.string(), z.unknown()).optional(),
});

export const GET = route<Ctx>(async (req, { params }) => {
  const { projectId, flagId } = await params;
  await requireProject(projectId, "viewer", req);
  return ok({ flag: await getFlag(projectId, flagId) });
});

export const PATCH = route<Ctx>(async (req, { params }) => {
  const { projectId, flagId } = await params;
  const a = await requireProject(projectId, "member", req);
  return ok({ flag: await updateFlag(a, req, flagId, await body(req, Patch)) });
});

export const DELETE = route<Ctx>(async (req, { params }) => {
  const { projectId, flagId } = await params;
  const a = await requireProject(projectId, "member", req);
  await deleteFlag(a, req, flagId);
  return ok({ deleted: true });
});
