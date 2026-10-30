import type { PGlite } from "@electric-sql/pglite";
import { withSystemDbTransaction } from "@/db/tenant-context";
import type { DbClient } from "@/lib/db";

export async function withGoalWatchEvaluationTransaction<T>(
  db: DbClient,
  callback: (transaction: DbClient) => Promise<T>,
): Promise<T> {
  const client = db as DbClient & {
    __runtime?: "postgres";
    __transaction?: boolean;
    transaction?: PGlite["transaction"];
  };
  if (client.__runtime === "postgres" || client.__transaction) {
    return withSystemDbTransaction(db, callback);
  }
  if (client.transaction) {
    // PGlite has one connection: its native transaction reserves that connection
    // for the entire callback, including concurrent Goal Watch evaluations.
    return client.transaction(async (transaction) => {
      const nestedClient: DbClient & { __transaction: true } = {
        __transaction: true,
        query: (sql, params) => transaction.query(sql, params),
      };
      return callback(nestedClient);
    });
  }
  return withSystemDbTransaction(db, callback);
}
