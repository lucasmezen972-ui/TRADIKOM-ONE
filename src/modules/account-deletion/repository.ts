import type { DbClient } from "@/lib/db";

export type AccountUserRow = {
  id: string;
  password_hash: string;
  deleted_at: string | null;
};

export type AccountMembershipRow = {
  tenant_id: string;
  role: string;
};

export type SoleOwnerTenantRow = {
  id: string;
  name: string;
};

export async function findAccountUserRow(db: DbClient, userId: string) {
  const result = await db.query<AccountUserRow>(
    "select id, password_hash, deleted_at from users where id = $1",
    [userId],
  );

  return result.rows[0] ?? null;
}

export async function listAccountMembershipRows(db: DbClient, userId: string) {
  const result = await db.query<AccountMembershipRow>(
    `select tenant_id, role
     from memberships
     where user_id = $1
     order by tenant_id asc`,
    [userId],
  );

  return result.rows;
}

export async function listSoleOwnerTenantRows(db: DbClient, userId: string) {
  const result = await db.query<SoleOwnerTenantRow>(
    `select tenants.id, tenants.name
     from memberships as owner_memberships
     join tenants on tenants.id = owner_memberships.tenant_id
     where owner_memberships.user_id = $1
       and owner_memberships.role = 'owner'
       and not exists (
         select 1
         from memberships as other_owners
         where other_owners.tenant_id = owner_memberships.tenant_id
           and other_owners.role = 'owner'
           and other_owners.user_id <> $1
       )
     order by tenants.name asc`,
    [userId],
  );

  return result.rows;
}

export async function setTransactionTenantContext(
  db: DbClient,
  tenantId: string,
) {
  await db.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
}

export async function deleteMembershipRow(
  db: DbClient,
  tenantId: string,
  userId: string,
) {
  await db.query(
    "delete from memberships where tenant_id = $1 and user_id = $2",
    [tenantId, userId],
  );
}

export async function revokeAllActiveSessionRows(
  db: DbClient,
  userId: string,
  revokedAt: string,
) {
  const result = await db.query(
    "update sessions set revoked_at = $1 where user_id = $2 and revoked_at is null",
    [revokedAt, userId],
  );

  return result.affectedRows ?? 0;
}

export async function deletePasswordResetTokenRows(
  db: DbClient,
  userId: string,
) {
  await db.query("delete from password_reset_tokens where user_id = $1", [
    userId,
  ]);
}

export async function anonymizeUserRow(
  db: DbClient,
  input: {
    userId: string;
    anonymizedName: string;
    anonymizedEmail: string;
    disabledPasswordHash: string;
    deletedAt: string;
  },
) {
  await db.query(
    `update users
     set name = $1, email = $2, password_hash = $3, deleted_at = $4
     where id = $5`,
    [
      input.anonymizedName,
      input.anonymizedEmail,
      input.disabledPasswordHash,
      input.deletedAt,
      input.userId,
    ],
  );
}
