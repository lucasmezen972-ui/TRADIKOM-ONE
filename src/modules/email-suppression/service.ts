import { withTenantDbTransaction } from "@/db/tenant-context";
import type { DbClient } from "@/lib/db";
import { recordAuditLog } from "@/modules/audit";
import { EmailSuppressionError } from "@/modules/email-suppression/errors";
import {
  deleteEmailSuppression,
  listEmailSuppressions,
} from "@/modules/email-suppression/repository";
import {
  releaseSuppressionSchema,
  type ReleaseSuppressionInput,
} from "@/modules/email-suppression/schemas";
import { assertTenantAccess } from "@/modules/tenants";

const suppressionRoles = ["owner", "administrator"] as const;
const suppressionListLimit = 50;

export async function getEmailSuppressions(
  db: DbClient,
  userId: string,
  tenantId: string,
) {
  await assertTenantAccess(db, userId, tenantId, [...suppressionRoles]);
  const rows = await listEmailSuppressions(db, tenantId, suppressionListLimit);

  return rows.map((row) => ({
    id: row.id,
    email: row.email,
    reason: row.reason,
    provider: row.provider,
    errorCode: row.error_code ?? undefined,
    detail: row.detail,
    suppressedByName: row.suppressed_by_name ?? undefined,
    createdAt: row.created_at,
  }));
}

/**
 * Réautorise une adresse corrigée entre-temps. Le geste est explicite et tracé :
 * il n'y a pas d'expiration automatique, un blocage ne disparaît pas tout seul.
 */
export async function releaseEmailSuppression(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: ReleaseSuppressionInput,
) {
  const parsed = releaseSuppressionSchema.parse(input);
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [
      ...suppressionRoles,
    ]);
    const removed = await deleteEmailSuppression(
      transaction,
      tenantId,
      parsed.email,
    );
    if (!removed) {
      throw new EmailSuppressionError(
        "email_suppression_not_found",
        "Cette adresse n'est pas bloquée.",
      );
    }

    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "email.suppression_released",
      targetType: "email_suppression",
      targetId: removed,
      metadata: {},
    });
    return { email: parsed.email };
  });
}
