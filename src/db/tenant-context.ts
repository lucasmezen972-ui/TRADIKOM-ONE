import { getPgPool, pgClientAsSqlClient, type SqlClient } from "@/db/client";
import type { DbClient } from "@/lib/db";

type TransactionClient = DbClient & {
  __runtime?: "postgres";
  __transaction?: boolean;
};

export async function withTenantDbTransaction<T>(
  db: DbClient,
  tenantId: string,
  actorId: string,
  callback: (client: DbClient) => Promise<T>,
) {
  const client = db as TransactionClient;
  if (client.__transaction) return callback(db);
  if (client.__runtime === "postgres") {
    return withTenantTransaction(tenantId, actorId, callback);
  }

  await db.query("begin");
  try {
    const result = await callback(db);
    await db.query("commit");
    return result;
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}

export async function withSystemDbTransaction<T>(
  db: DbClient,
  callback: (client: DbClient) => Promise<T>,
) {
  const client = db as TransactionClient;
  if (client.__transaction) return callback(db);
  if (client.__runtime === "postgres") {
    return withSystemTransaction(callback);
  }

  await db.query("begin");
  try {
    const result = await callback(db);
    await db.query("commit");
    return result;
  } catch (error) {
    await db.query("rollback");
    throw error;
  }
}

export async function withTenantTransaction<T>(
  tenantId: string,
  actorId: string,
  callback: (client: SqlClient) => Promise<T>,
) {
  const pool = getPgPool();
  const client = await pool.connect();

  try {
    await client.query("begin");
    await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    await client.query("select set_config('app.actor_id', $1, true)", [actorId]);
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

export async function withSystemTransaction<T>(
  callback: (client: SqlClient) => Promise<T>,
) {
  const pool = getPgPool();
  const client = await pool.connect();

  try {
    await client.query("begin");
    await client.query("select set_config('app.system_access', 'true', true)");
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
