import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

export * as schema from "./schema";
export * from "./schema";
export * from "./crypto";

export type Db = PostgresJsDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __hostpogDb?: { db: Db; sql: postgres.Sql } };

export function getDb(): Db {
  if (!globalForDb.__hostpogDb) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("DATABASE_URL is not set");
    const client = postgres(url, { max: Number(process.env.DATABASE_POOL_SIZE ?? 10), prepare: true });
    globalForDb.__hostpogDb = { db: drizzle(client, { schema }), sql: client };
  }
  return globalForDb.__hostpogDb.db;
}

/** The underlying postgres.js client (for things drizzle doesn't cover, e.g. reserved connections). */
export function getSqlClient(): postgres.Sql {
  getDb();
  return globalForDb.__hostpogDb!.sql;
}

export async function closeDb(): Promise<void> {
  if (globalForDb.__hostpogDb) {
    await globalForDb.__hostpogDb.sql.end({ timeout: 5 });
    globalForDb.__hostpogDb = undefined;
  }
}
