import { getDb } from "@hostpog/db";
import { getClickHouse } from "@hostpog/native";
import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, string> = {};
  try {
    await getDb().execute(sql`select 1`);
    checks.postgres = "ok";
  } catch (e) {
    checks.postgres = `error: ${(e as Error).message.slice(0, 80)}`;
  }
  try {
    await getClickHouse().ping();
    checks.clickhouse = "ok";
  } catch {
    checks.clickhouse = "unavailable (native sources disabled)";
  }
  const ok = checks.postgres === "ok";
  return NextResponse.json({ ok, service: "hostpog-web", checks }, { status: ok ? 200 : 503 });
}
