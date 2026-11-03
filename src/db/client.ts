import { drizzle } from "drizzle-orm/node-postgres";
import { Pool, type PoolClient, type PoolConfig, type QueryResultRow } from "pg";
import * as schema from "@/db/schema";

export type SqlQueryResult<T = Record<string, unknown>> = {
  rows: T[];
  affectedRows?: number;
};

export type SqlClient = {
  __runtime?: "postgres";
  __transaction?: boolean;
  __withTransaction?: <T>(
    context: SqlTransactionContext,
    callback: (client: SqlClient) => Promise<T>,
  ) => Promise<T>;
  query: <T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ) => Promise<SqlQueryResult<T>>;
};

export type SqlTransactionContext = {
  tenantId?: string;
  actorId?: string;
  systemAccess?: boolean;
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
    pool = new Pool(getPgPoolConfig(process.env));
  }

  return pool;
}

export function getPgPoolConfig(environment: Record<string, string | undefined>): PoolConfig {
  const connectionString = environment.DATABASE_URL;
  const base = {
    connectionString,
    max: Number(environment.DATABASE_POOL_MAX ?? 10),
  };
  if (!environment.DATABASE_SSL_CA) return base;
  if (!connectionString) throw new Error("DATABASE_URL is required for PostgreSQL runtime.");
  const url = new URL(connectionString);
  const sslMode = url.searchParams.get("sslmode");
  if ((sslMode && sslMode !== "verify-full") ||
      ["ssl", "sslnegotiation", "sslcert", "sslkey", "sslrootcert", "uselibpqcompat"].some((key) => url.searchParams.has(key))) {
    throw new Error("DATABASE_SSL_CA requires verify-full without conflicting URL TLS options.");
  }
  // node-postgres otherwise replaces the explicit TLS object with URL options.
  url.searchParams.delete("sslmode");
  return {
    ...base,
    connectionString: url.toString(),
    ssl: { ca: environment.DATABASE_SSL_CA, rejectUnauthorized: true },
  };
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
    __runtime: "postgres",
    __withTransaction: (context, callback) =>
      withPgPoolTransaction(pgPool, context, callback),
    async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
      const result = await pgPool.query<QueryResultRow>(sql, params);
      return {
        rows: result.rows as T[],
        affectedRows: result.rowCount ?? undefined,
      };
    },
  };
}

export async function withPgPoolTransaction<T>(
  pgPool: Pool,
  context: SqlTransactionContext,
  callback: (client: SqlClient) => Promise<T>,
) {
  const client = await pgPool.connect();

  try {
    await client.query("begin");
    if (context.tenantId) {
      await client.query("select set_config('app.tenant_id', $1, true)", [
        context.tenantId,
      ]);
    }
    if (context.actorId) {
      await client.query("select set_config('app.actor_id', $1, true)", [
        context.actorId,
      ]);
    }
    if (context.systemAccess) {
      await client.query("select set_config('app.system_access', 'true', true)");
    }
    const result = await callback(pgClientAsSqlClient(client));
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

export function pgClientAsSqlClient(client: PoolClient): SqlClient {
  return {
    __runtime: "postgres",
    __transaction: true,
    async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
      const result = await client.query<QueryResultRow>(sql, params);
      return {
        rows: result.rows as T[],
        affectedRows: result.rowCount ?? undefined,
      };
    },
  };
}
