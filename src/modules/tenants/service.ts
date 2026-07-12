import type { DbClient } from "@/lib/db";
import { daysFromNow, hashToken, id, nowIso, secureToken, slugify } from "@/lib/security";
import type { Membership, Role, Tenant } from "@/lib/types";
import {
  findUserByEmail,
  findUserById,
  mapUser,
  registerUser,
} from "@/modules/auth";
import { recordAuditLog } from "@/modules/audit";
import { TenantError } from "@/modules/tenants/errors";
import {
  findMembershipRole,
  findPendingInvitationByTokenHash,
  findTenantById,
  findTenantBySlug,
  findTenantOwnerId,
  insertInvitation,
  insertMembership,
  insertTenant,
  listPendingInvitations,
  listTenantMembers,
  listUserTenantRows,
  markInvitationAccepted,
  revokePendingInvitationsForEmail,
  tenantMemberExistsByEmail,
  tenantSlugExists,
  updateMembershipRole,
  type InvitationRow,
  type TenantRow,
} from "@/modules/tenants/repository";
import {
  acceptInvitationSchema,
  invitationSchema,
  orgSchema,
  updateMemberRoleSchema,
  type AcceptInvitationInput,
  type CreateInvitationInput,
  type CreateTenantInput,
  type UpdateMemberRoleInput,
} from "@/modules/tenants/schemas";
import { enforceRateLimit, rateLimitPolicies } from "@/modules/rate-limit";

const allTenantRoles: Role[] = [
  "owner",
  "administrator",
  "manager",
  "collaborator",
  "read-only",
];

export async function createTenant(
  db: DbClient,
  userId: string,
  input: CreateTenantInput,
  dependencies: {
    createDefaults: (db: DbClient, tenantId: string) => Promise<void>;
  },
) {
  const parsed = orgSchema.parse(input);
  const tenantId = id("tenant");
  const now = nowIso();
  const slug = await uniqueSlug(db, parsed.name);

  await insertTenant(db, {
    id: tenantId,
    name: parsed.name,
    slug,
    category: parsed.category,
    createdAt: now,
  });
  await insertMembership(db, {
    tenantId,
    userId,
    role: "owner",
    createdAt: now,
  });
  await dependencies.createDefaults(db, tenantId);
  await recordAuditLog(db, {
    tenantId,
    actorId: userId,
    action: "organization.created",
    targetType: "tenant",
    targetId: tenantId,
    metadata: { name: parsed.name },
  });

  return {
    id: tenantId,
    name: parsed.name,
    slug,
    category: parsed.category,
    createdAt: now,
  } satisfies Tenant;
}

export async function getUserTenants(db: DbClient, userId: string) {
  const rows = await listUserTenantRows(db, userId);

  return rows.map((row) => ({
    tenant: mapTenant(row),
    membership: {
      tenantId: row.id,
      userId,
      role: row.role,
    } satisfies Membership,
  }));
}

export async function getTenantContext(
  db: DbClient,
  userId: string,
  preferredTenantId?: string,
) {
  const tenants = await getUserTenants(db, userId);
  if (tenants.length === 0) {
    return null;
  }

  return tenants.find((item) => item.tenant.id === preferredTenantId) ?? tenants[0];
}

export async function getTenantMembers(
  db: DbClient,
  userId: string,
  tenantId: string,
) {
  await assertTenantAccess(db, userId, tenantId);
  const rows = await listTenantMembers(db, tenantId);

  return rows.map((row) => ({
    user: mapUser(row),
    membership: {
      tenantId,
      userId: row.id,
      role: row.role,
    } satisfies Membership,
    joinedAt: row.membership_created_at,
  }));
}

export async function getPendingInvitations(
  db: DbClient,
  userId: string,
  tenantId: string,
) {
  await assertTenantAccess(db, userId, tenantId, ["owner", "administrator"]);
  const rows = await listPendingInvitations(db, tenantId, nowIso());

  return rows.map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    email: row.email,
    role: row.role,
    status: row.status,
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  }));
}

export async function createInvitation(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: CreateInvitationInput,
) {
  const actorRole = await assertTenantAccess(db, userId, tenantId, [
    "owner",
    "administrator",
  ]);
  const parsed = invitationSchema.parse(input);
  const email = parsed.email.toLowerCase();
  await enforceRateLimit(db, {
    operationKey: "invitation.create",
    subjectKey: email,
    scopeKey: tenantId,
    limit: rateLimitPolicies.invitationCreate.limit,
    windowSeconds: rateLimitPolicies.invitationCreate.windowSeconds,
  });

  if (parsed.role === "administrator" && actorRole !== "owner") {
    throw new TenantError(
      "member_role_forbidden",
      "Seul un propriétaire peut inviter un administrateur.",
    );
  }

  if (await tenantMemberExistsByEmail(db, tenantId, email)) {
    throw new TenantError(
      "member_exists",
      "Cet utilisateur est déjà membre de l'organisation.",
    );
  }

  const now = nowIso();
  const invitationToken = secureToken();
  const invitationId = id("invite");
  const expiresAt = daysFromNow(7);

  await revokePendingInvitationsForEmail(db, tenantId, email);
  await insertInvitation(db, {
    id: invitationId,
    tenantId,
    email,
    role: parsed.role,
    tokenHash: hashToken(invitationToken),
    expiresAt,
    createdAt: now,
  });
  await recordAuditLog(db, {
    tenantId,
    actorId: userId,
    action: "team.invitation_created",
    targetType: "invitation",
    targetId: invitationId,
    metadata: { email, role: parsed.role },
  });

  return {
    id: invitationId,
    email,
    role: parsed.role,
    invitationToken,
    expiresAt,
  };
}

export async function acceptInvitation(
  db: DbClient,
  input: AcceptInvitationInput,
) {
  const parsed = acceptInvitationSchema.parse(input);
  await enforceRateLimit(db, {
    operationKey: "invitation.accept",
    subjectKey: hashToken(parsed.token),
    limit: rateLimitPolicies.invitationAccept.limit,
    windowSeconds: rateLimitPolicies.invitationAccept.windowSeconds,
  });
  const invitation = await findPendingInvitation(db, parsed.token);

  if (!invitation) {
    throw new TenantError("invalid_invitation", "Invitation invalide ou expirée.");
  }

  const existingUser = await findUserByEmail(db, invitation.email);

  if (existingUser) {
    throw new TenantError(
      "invitation_account_exists",
      "Ce compte existe déjà. Connectez-vous puis ouvrez à nouveau le lien d'invitation.",
    );
  }

  const user = await registerUser(db, {
    name: parsed.name,
    email: invitation.email,
    password: parsed.password,
  });
  const membership = await completeInvitation(db, invitation, user.id);
  const tenant = await getTenantById(db, invitation.tenant_id);

  return { user, tenant, membership };
}

export async function acceptInvitationForUser(
  db: DbClient,
  userId: string,
  token: string,
) {
  await enforceRateLimit(db, {
    operationKey: "invitation.accept_authenticated",
    subjectKey: hashToken(token),
    limit: rateLimitPolicies.invitationAccept.limit,
    windowSeconds: rateLimitPolicies.invitationAccept.windowSeconds,
  });
  const invitation = await findPendingInvitation(db, token);

  if (!invitation) {
    throw new TenantError("invalid_invitation", "Invitation invalide ou expirée.");
  }

  const user = await findUserById(db, userId);

  if (!user || user.email !== invitation.email) {
    throw new TenantError(
      "invitation_account_mismatch",
      "Cette invitation ne correspond pas au compte connecté.",
    );
  }

  const membership = await completeInvitation(db, invitation, userId);
  const tenant = await getTenantById(db, invitation.tenant_id);

  return { user: mapUser(user), tenant, membership };
}

export async function updateMemberRole(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: UpdateMemberRoleInput,
) {
  const actorRole = await assertTenantAccess(db, userId, tenantId, [
    "owner",
    "administrator",
  ]);
  const parsed = updateMemberRoleSchema.parse(input);

  if (parsed.targetUserId === userId) {
    throw new TenantError(
      "member_role_protected",
      "Votre propre rôle ne peut pas être modifié ici.",
    );
  }

  const currentRole = await findMembershipRole(db, parsed.targetUserId, tenantId);

  if (!currentRole) {
    throw new TenantError("member_not_found", "Membre introuvable.");
  }

  if (currentRole === "owner") {
    throw new TenantError(
      "member_role_protected",
      "Le rôle propriétaire ne peut pas être modifié.",
    );
  }

  if (
    actorRole !== "owner" &&
    (currentRole === "administrator" || parsed.role === "administrator")
  ) {
    throw new TenantError(
      "member_role_forbidden",
      "Seul un propriétaire peut gérer les administrateurs.",
    );
  }

  await updateMembershipRole(db, tenantId, parsed.targetUserId, parsed.role);
  await recordAuditLog(db, {
    tenantId,
    actorId: userId,
    action: "team.member_role_updated",
    targetType: "membership",
    targetId: parsed.targetUserId,
    metadata: { previousRole: currentRole, role: parsed.role },
  });

  return {
    tenantId,
    userId: parsed.targetUserId,
    role: parsed.role,
  } satisfies Membership;
}

export async function assertTenantAccess(
  db: DbClient,
  userId: string,
  tenantId: string,
  allowedRoles: Role[] = allTenantRoles,
) {
  const role = await findMembershipRole(db, userId, tenantId);

  if (!role || !allowedRoles.includes(role)) {
    throw new TenantError(
      "tenant_access_denied",
      "Acces refuse pour cette organisation.",
    );
  }

  return role;
}

export async function findPendingInvitation(db: DbClient, token: string) {
  if (!token) {
    return null;
  }

  return findPendingInvitationByTokenHash(db, hashToken(token), nowIso());
}

export async function getTenantById(db: DbClient, tenantId: string) {
  const tenant = await findTenantById(db, tenantId);
  if (!tenant) {
    throw new TenantError("tenant_not_found", "Organisation introuvable.");
  }

  return mapTenant(tenant);
}

export async function getTenantBySlug(db: DbClient, slug: string) {
  const tenant = await findTenantBySlug(db, slug);
  return tenant ? mapTenant(tenant) : null;
}

export async function getTenantOwnerId(db: DbClient, tenantId: string) {
  const ownerId = await findTenantOwnerId(db, tenantId);
  if (!ownerId) {
    throw new TenantError(
      "tenant_owner_not_found",
      "Aucun proprietaire trouve pour cette organisation.",
    );
  }

  return ownerId;
}

async function completeInvitation(
  db: DbClient,
  invitation: InvitationRow,
  userId: string,
) {
  const now = nowIso();
  const existingRole = await findMembershipRole(db, userId, invitation.tenant_id);

  if (!existingRole) {
    await insertMembership(db, {
      tenantId: invitation.tenant_id,
      userId,
      role: invitation.role,
      createdAt: now,
    });
  }

  await markInvitationAccepted(db, invitation.id);
  await recordAuditLog(db, {
    tenantId: invitation.tenant_id,
    actorId: userId,
    action: "team.invitation_accepted",
    targetType: "invitation",
    targetId: invitation.id,
    metadata: { email: invitation.email, role: invitation.role },
  });

  return {
    tenantId: invitation.tenant_id,
    userId,
    role: existingRole ?? invitation.role,
  } satisfies Membership;
}

async function uniqueSlug(db: DbClient, value: string) {
  const base = slugify(value) || "organisation";
  let candidate = base;
  let suffix = 1;

  while (await tenantSlugExists(db, candidate)) {
    suffix += 1;
    candidate = `${base}-${suffix}`;
  }

  return candidate;
}

function mapTenant(row: TenantRow): Tenant {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    category: row.category,
    createdAt: row.created_at,
  };
}
