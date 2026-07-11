import { getDatabaseUrl } from "@/db/client";
import { withSystemTransaction } from "@/db/tenant-context";
import { closeDb, getDb, type DbClient } from "@/lib/db";
import {
  getPendingDomainEventCount,
  processPendingDomainEvents,
} from "@/modules/workflows/worker";

async function main() {
  const result = await runWorkerBatch();

  console.log(
    [
      `TRADIKOM worker processed ${result.summary.processed} event(s).`,
      `Succeeded: ${result.summary.succeeded}.`,
      `Retried: ${result.summary.retried}.`,
      `Failed: ${result.summary.failed}.`,
      `Requeued: ${result.summary.requeued}.`,
      `Due pending before/after: ${result.pendingBefore}/${result.pendingAfter}.`,
    ].join(" "),
  );
}

async function runWorkerBatch() {
  const batchSize = parseWorkerBatchSize();

  if (getDatabaseUrl()) {
    await getDb();
    return withSystemTransaction((db) => runWithClient(db, batchSize));
  }

  const db = await getDb();
  return runWithClient(db, batchSize);
}

async function runWithClient(db: DbClient, limit: number) {
  const pendingBefore = await getPendingDomainEventCount(db);
  const summary = await processPendingDomainEvents(db, { limit });
  const pendingAfter = await getPendingDomainEventCount(db);

  return { pendingBefore, summary, pendingAfter };
}

function parseWorkerBatchSize() {
  const batchSize = Number(process.env.WORKER_BATCH_SIZE ?? 25);

  if (!Number.isFinite(batchSize)) {
    return 25;
  }

  return Math.max(1, Math.floor(batchSize));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeDb();
  });
