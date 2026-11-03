import { closePgPool, getDatabaseUrl, pgPoolAsSqlClient } from "../src/db/client";
import { closeDb, getDb, migrate } from "../src/lib/db";

async function main() {
  try {
    if (getDatabaseUrl()) {
      // Invoke only with the dedicated migration identity, never the web login.
      await migrate(pgPoolAsSqlClient(), { enableRls: true });
    } else {
      const db = await getDb();
      await db.query("select 1");
    }
    console.log("Database migrated.");
  } finally {
    await closeDb();
    await closePgPool();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
