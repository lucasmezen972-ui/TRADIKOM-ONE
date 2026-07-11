import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient, type QueryResultRow } from "pg";
import * as schema from "@/db/schema";

export type SqlQueryResult<T = Record<string, unknown>> = {
  rows: T[];
  affectedRows?: number;
};

export type SqlClient = {
  query: <T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ) => Promise<SqlQueryResult<T>>;
};

let pool: Pool | null = null;

export function getDatabaseUrl() {
  return process.env.DATABASE_URL;
}

export function getPgPool() {
  const databaseUrl = getDatabaseUrl();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for PostgreSQL runtime.");
  }

  if (!pool) {
    pool = new Pool({
      connectionString: databaseUrl,
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
    });
  }

  return pool;
}

export async function closePgPool() {
  if (!pool) {
    return;
  }

  await pool.end();
  pool = null;
}

export function getDrizzleDb() {
  return drizzle(getPgPool(), { schema });
}

export function pgPoolAsSqlClient(pgPool = getPgPool()): SqlClient {
  return {
    async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
      const result = await pgPool.query<QueryResultRow>(sql, params);
      return {
        rows: result.rows as T[],
        affectedRows: result.rowCount ?? undefined,
      };
    },
  };
}

export function pgClientAsSqlClient(client: PoolClient): SqlClient {
  return {
    async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
      const result = await client.query<QueryResultRow>(sql, params);
      return {
        rows: result.rows as T[],
        affectedRows: result.rowCount ?? undefined,
      };
    },
  };
}
