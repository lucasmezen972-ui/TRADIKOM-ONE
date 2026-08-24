import { withTenantDbTransaction } from "@/db/tenant-context";
import type { DbClient } from "@/lib/db";
import { nowIso, verifyPassword } from "@/lib/security";
import { AccountDeletionError } from "@/modules/account-deletion/errors";
import {
  anonymizeUserRow,
  deleteMembershipRow,
  deletePasswordResetTokenRows,
  findAccountUserRow,
  listAccountMembershipRows,
  listSoleOwnerTenantRows,
  revokeAllActiveSessionRows,
  setTransactionTenantContext,
} from "@/modules/account-deletion/repository";
import {
  deleteAccountSchema,
  type DeleteAccountInput,
} from "@/modules/account-deletion/schemas";
import { recordAuditLog } from "@/modules/audit";

const anonymizedName = "Compte supprimé";
const disabledPasswordHash = "supprime";

export function anonymizedEmailForUser(userId: string) {
  return `compte-supprime-${userId.replaceAll("_", "-")}@anonymise.tradikom.invalid`;
}

export async function deleteAccount(
  db: DbClient,
  userId: string,
  input: DeleteAccountInput,
) {
  const parsed = deleteAccountSchema.parse(input);

  const user = await findAccountUserRow(db, userId);
  if (!user || user.deleted_at) {
    throw new AccountDeletionError(
      "account_not_found",
      "Compte introuvable ou déjà supprimé.",
    );
  }

  if (!verifyPassword(parsed.password, user.password_hash)) {
    throw new AccountDeletionError(
      "invalid_password",
      "Mot de passe incorrect. La suppression du compte a été refusée.",
    );
  }

  const soleOwnerTenants = await listSoleOwnerTenantRows(db, userId);
  if (soleOwnerTenants.length > 0) {
    const names = soleOwnerTenants.map((tenant) => tenant.name).join(", ");
    throw new AccountDeletionError(
      "sole_owner_conflict",
      `Vous êtes le seul propriétaire de : ${names}. Transférez la propriété, ou quittez/supprimez ces organisations avant de supprimer votre compte.`,
    );
  }

  const memberships = await listAccountMembershipRows(db, userId);

  return withTenantDbTransaction(
    db,
    memberships[0]?.tenant_id ?? "",
    userId,
    async (transaction) => {
      const now = nowIso();

      for (const membership of memberships) {
        await setTransactionTenantContext(transaction, membership.tenant_id);
        await recordAuditLog(transaction, {
          tenantId: membership.tenant_id,
          actorId: userId,
          action: "account.deletion_requested",
          targetType: "user",
          targetId: userId,
          metadata: { role: membership.role, passwordConfirmed: true },
        });
        await deleteMembershipRow(transaction, membership.tenant_id, userId);
      }

      const revokedSessions = await revokeAllActiveSessionRows(
        transaction,
        userId,
        now,
      );
      await deletePasswordResetTokenRows(transaction, userId);
      await anonymizeUserRow(transaction, {
        userId,
        anonymizedName,
        anonymizedEmail: anonymizedEmailForUser(userId),
        disabledPasswordHash,
        deletedAt: now,
      });

      for (const membership of memberships) {
        await setTransactionTenantContext(transaction, membership.tenant_id);
        await recordAuditLog(transaction, {
          tenantId: membership.tenant_id,
          actorId: userId,
          action: "account.deletion_executed",
          targetType: "user",
          targetId: userId,
          metadata: {
            sessionsRevoked: revokedSessions,
            membershipsRemoved: memberships.length,
            personalDataAnonymized: true,
          },
        });
      }

      return {
        deleted: true as const,
        deletedAt: now,
        sessionsRevoked: revokedSessions,
        membershipsRemoved: memberships.length,
      };
    },
  );
}
