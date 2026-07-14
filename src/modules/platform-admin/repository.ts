import type { DbClient } from "@/lib/db";

export async function findPlatformRole(db: DbClient, userId: string) {
  const result = await db.query<{ platform_role: string }>(
    "select platform_role from users where id = $1",
    [userId],
  );
  return result.rows[0]?.platform_role ?? null;
}

export async function setPlatformRole(
  db: DbClient,
  userId: string,
  role: "user" | "platform_admin",
) {
  await db.query("update users set platform_role = $1 where id = $2", [
    role,
    userId,
  ]);
}
