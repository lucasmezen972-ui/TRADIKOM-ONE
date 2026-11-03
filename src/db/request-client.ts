import type { SqlClient, SqlTransactionContext } from "./client";

// Legacy service reads still use db.query directly. Give those reads the same
// tenant/actor context as explicit service transactions, without enabling system access.
export function createRequestScopedDb(db: SqlClient, context: { tenantId: string; actorId: string }): SqlClient {
  if (db.__runtime !== "postgres" || db.__transaction) return db;
  if (!db.__withTransaction) throw new Error("PostgreSQL transaction capability is required.");
  const transaction = db.__withTransaction.bind(db);
  const requestContext = Object.freeze({ tenantId: context.tenantId, actorId: context.actorId });
  return {
    __runtime: "postgres",
    query: (sql, params) => transaction(requestContext, client => client.query(sql, params)),
    // Specialized brokers keep their explicit transaction and authorization boundaries.
    __withTransaction: <T>(operation: SqlTransactionContext, callback: (client: SqlClient) => Promise<T>) =>
      transaction({ ...requestContext, ...operation }, callback),
  };
}
