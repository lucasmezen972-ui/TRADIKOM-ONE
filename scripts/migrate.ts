import { closeDb, getDb } from "../src/lib/db";

async function main() {
  const db = await getDb();
  await db.query("select 1");
  console.log("Database migrated.");
  await closeDb();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
