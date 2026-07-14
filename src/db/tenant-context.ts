import {
  getPgPool,
  withPgPoolTransaction,
  type SqlClient,
} from "@/db/client";
import type { DbClient } from "@/lib/db";

type TransactionClient = DbClient & {
  __runtime?: "postgres";
  __transaction?: boolean;
  __withTransaction?: SqlClient["__withTransaction"];
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
    if (!client.__withTransaction) {
      throw new Error("PostgreSQL client does not expose transaction capability.");
    }
    return client.__withTransaction({ tenantId, actorId }, callback);
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
    if (!client.__withTransaction) {
      throw new Error("PostgreSQL client does not expose transaction capability.");
    }
    return client.__withTransaction({ systemAccess: true }, callback);
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
  return withPgPoolTransaction(
    getPgPool(),
    { tenantId, actorId },
    callback,
  );
}

export async function withSystemTransaction<T>(
  callback: (client: SqlClient) => Promise<T>,
) {
  return withPgPoolTransaction(
    getPgPool(),
    { systemAccess: true },
    callback,
  );
}
