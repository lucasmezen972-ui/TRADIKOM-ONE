import { closeDb, getDb } from "../src/lib/db";
import { runMaintenance } from "../src/modules/maintenance";

async function main() {
  const db = await getDb();
  const summary = await runMaintenance(db, {
    batchSize: Number(process.env.MAINTENANCE_BATCH_SIZE || 500),
  });
  console.log(
    JSON.stringify({
      event: "maintenance.completed",
      timestamp: new Date().toISOString(),
      summary,
    }),
  );
}

main()
  .catch((error) => {
    console.error(
      JSON.stringify({
        event: "maintenance.failed",
        errorType: error instanceof Error ? error.name : typeof error,
      }),
    );
    process.exitCode = 1;
  })
  .finally(closeDb);
