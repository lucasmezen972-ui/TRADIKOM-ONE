import type { DbClient } from "@/lib/db";
import { runMaintenance } from "@/modules/maintenance/service";

export async function handleScheduledMaintenance(
  db: DbClient,
  input: { now?: Date; batchSize?: number } = {},
) {
  return runMaintenance(db, input);
}
