import type { DbClient } from "@/lib/db";

export async function tenantHasContacts(db: DbClient, tenantId: string) {
  const result = await db.query<{ id: string }>(
    "select id from contacts where tenant_id = $1 limit 1",
    [tenantId],
  );

  return result.rows.length > 0;
}
