import type { DbClient } from "@/lib/db";
import type { Role } from "@/lib/types";

export type TenantRow = {
  id: string;
  name: string;
  slug: string;
  category: string;
  created_at: string;
};

export type InvitationRow = {
  id: string;
  tenant_id: string;
  email: string;
  role: Role;
  status: string;
  token_hash: string;
  expires_at: string;
  delivery_status: string;
  delivery_provider: string | null;
  delivery_attempts: number;
  delivery_last_attempt_at: string | null;
  delivery_error_code: string | null;
  created_at: string;
};

export type TenantMemberRow = {
  id: string;
  name: string;
  email: string;
  created_at: string;
  role: Role;
  membership_created_at: string;
};

export async function insertTenant(
  db: DbClient,
  tenant: {
    id: string;
    name: string;
    slug: string;
    category: string;
    createdAt: string;
  },
) {
  await db.query(
    "insert into tenants (id, name, slug, category, created_at) values ($1, $2, $3, $4, $5)",
    [tenant.id, tenant.name, tenant.slug, tenant.category, tenant.createdAt],
  );
}

export async function tenantSlugExists(db: DbClient, slug: string) {
  const exists = await db.query("select id from tenants where slug = $1", [slug]);
  return exists.rows.length > 0;
}

export async function findTenantById(db: DbClient, tenantId: string) {
  const result = await db.query<TenantRow>("select * from tenants where id = $1", [
    tenantId,
  ]);
  return result.rows[0] ?? null;
}

export async function findTenantBySlug(db: DbClient, slug: string) {
  const result = await db.query<TenantRow>("select * from tenants where slug = $1", [
    slug,
  ]);
  return result.rows[0] ?? null;
}

export async function listUserTenantRows(db: DbClient, userId: string) {
  const result = await db.query<TenantRow & { role: Role }>(
    `select tenants.*, memberships.role
     from tenants
     join memberships on memberships.tenant_id = tenants.id
     where memberships.user_id = $1
     order by tenants.created_at asc`,
    [userId],
  );

  return result.rows;
}

export async function findMembershipRole(
  db: DbClient,
  userId: string,
  tenantId: string,
) {
  const result = await db.query<{ role: Role }>(
    "select role from memberships where user_id = $1 and tenant_id = $2",
    [userId, tenantId],
  );

  return result.rows[0]?.role ?? null;
}

export async function insertMembership(
  db: DbClient,
  input: {
    tenantId: string;
    userId: string;
    role: Role;
    createdAt: string;
  },
) {
  await db.query(
    "insert into memberships (tenant_id, user_id, role, created_at) values ($1, $2, $3, $4)",
    [input.tenantId, input.userId, input.role, input.createdAt],
  );
}

export async function listTenantMembers(db: DbClient, tenantId: string) {
  const result = await db.query<TenantMemberRow>(
    `select users.id, users.name, users.email, users.created_at, memberships.role, memberships.created_at as membership_created_at
     from memberships
     join users on users.id = memberships.user_id
     where memberships.tenant_id = $1
     order by case when memberships.role = 'owner' then 0 when memberships.role = 'administrator' then 1 else 2 end, users.name asc`,
    [tenantId],
  );

  return result.rows;
}

export async function listPendingInvitations(
  db: DbClient,
  tenantId: string,
  now: string,
) {
  const result = await db.query<InvitationRow>(
    `select *
     from invitations
     where tenant_id = $1 and status = $2 and expires_at > $3
     order by created_at desc`,
    [tenantId, "pending", now],
  );

  return result.rows;
}

export async function tenantMemberExistsByEmail(
  db: DbClient,
  tenantId: string,
  email: string,
) {
  const existingMember = await db.query(
    `select memberships.user_id
     from memberships
     join users on users.id = memberships.user_id
     where memberships.tenant_id = $1 and users.email = $2`,
    [tenantId, email],
  );

  return existingMember.rows.length > 0;
}

export async function revokePendingInvitationsForEmail(
  db: DbClient,
  tenantId: string,
  email: string,
) {
  await db.query(
    "update invitations set status = $1 where tenant_id = $2 and email = $3 and status = $4",
    ["revoked", tenantId, email, "pending"],
  );
}

export async function insertInvitation(
  db: DbClient,
  invitation: {
    id: string;
    tenantId: string;
    email: string;
    role: Role;
    tokenHash: string;
    expiresAt: string;
    createdAt: string;
  },
) {
  await db.query(
    "insert into invitations (id, tenant_id, email, role, status, token_hash, expires_at, created_at) values ($1, $2, $3, $4, $5, $6, $7, $8)",
    [
      invitation.id,
      invitation.tenantId,
      invitation.email,
      invitation.role,
      "pending",
      invitation.tokenHash,
      invitation.expiresAt,
      invitation.createdAt,
    ],
  );
}

export async function findPendingInvitationForTenant(
  db: DbClient,
  tenantId: string,
  invitationId: string,
) {
  const result = await db.query<InvitationRow>(
    `select * from invitations
     where id = $1 and tenant_id = $2 and status = $3`,
    [invitationId, tenantId, "pending"],
  );

  return result.rows[0] ?? null;
}

export async function replacePendingInvitationToken(
  db: DbClient,
  input: {
    tenantId: string;
    invitationId: string;
    tokenHash: string;
    expiresAt: string;
  },
) {
  await db.query(
    `update invitations
     set token_hash = $1, expires_at = $2, delivery_status = $3,
         delivery_provider = null, delivery_error_code = null
     where id = $4 and tenant_id = $5 and status = $6`,
    [
      input.tokenHash,
      input.expiresAt,
      "pending",
      input.invitationId,
      input.tenantId,
      "pending",
    ],
  );
}

export async function updateInvitationDelivery(
  db: DbClient,
  input: {
    tenantId: string;
    invitationId: string;
    status: string;
    provider: string;
    attemptedAt: string;
    errorCode?: string;
  },
) {
  await db.query(
    `update invitations
     set delivery_status = $1, delivery_provider = $2,
         delivery_attempts = delivery_attempts + 1,
         delivery_last_attempt_at = $3, delivery_error_code = $4
     where id = $5 and tenant_id = $6`,
    [
      input.status,
      input.provider,
      input.attemptedAt,
      input.errorCode ?? null,
      input.invitationId,
      input.tenantId,
    ],
  );
}

export async function findPendingInvitationByTokenHash(
  db: DbClient,
  tokenHash: string,
  now: string,
) {
  const result = await db.query<InvitationRow>(
    `select *
     from invitations
     where token_hash = $1 and status = $2 and expires_at > $3`,
    [tokenHash, "pending", now],
  );

  return result.rows[0] ?? null;
}

export async function updateMembershipRole(
  db: DbClient,
  tenantId: string,
  userId: string,
  role: Role,
) {
  await db.query(
    "update memberships set role = $1 where tenant_id = $2 and user_id = $3",
    [role, tenantId, userId],
  );
}

export async function markInvitationAccepted(db: DbClient, invitationId: string) {
  await db.query("update invitations set status = $1 where id = $2", [
    "accepted",
    invitationId,
  ]);
}

export async function findTenantOwnerId(db: DbClient, tenantId: string) {
  const owner = await db.query<{ user_id: string }>(
    "select user_id from memberships where tenant_id = $1 order by case when role = 'owner' then 0 else 1 end limit 1",
    [tenantId],
  );

  return owner.rows[0]?.user_id ?? null;
}
