import { getDb } from "@/lib/db";

async function main() {
  const db = await getDb();
  const pending = await db.query<{ count: number }>(
    "select count(*)::int as count from domain_events where status = $1",
    ["pending"],
  );

  console.log(
    `TRADIKOM worker ready. Pending events: ${pending.rows[0]?.count ?? 0}`,
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
