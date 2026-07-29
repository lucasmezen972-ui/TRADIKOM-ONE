import type { DbClient } from "@/lib/db";
import type { SuppressionReason } from "@/modules/email-suppression/schemas";

export type EmailSuppressionRow = {
  id: string;
  tenant_id: string;
  email: string;
  reason: SuppressionReason;
  provider: string;
  error_code: string | null;
  detail: string;
  suppressed_by: string | null;
  created_at: string;
};

export async function findEmailSuppression(
  db: DbClient,
  tenantId: string,
  email: string,
) {
  const result = await db.query<EmailSuppressionRow>(
    "select * from email_suppressions where tenant_id = $1 and email = $2",
    [tenantId, email],
  );
  return result.rows[0] ?? null;
}

export async function listEmailSuppressions(
  db: DbClient,
  tenantId: string,
  limit: number,
) {
  const result = await db.query<
    EmailSuppressionRow & { suppressed_by_name: string | null }
  >(
    `select suppressions.*, users.name as suppressed_by_name
     from email_suppressions as suppressions
     left join users on users.id = suppressions.suppressed_by
     where suppressions.tenant_id = $1
     order by suppressions.created_at desc
     limit $2`,
    [tenantId, limit],
  );
  return result.rows;
}

/**
 * Une adresse déjà supprimée garde sa première cause : c'est elle qui explique
 * pourquoi l'organisation ne peut plus écrire à cette personne, et un second
 * échec ne dit rien de neuf.
 */
export async function insertEmailSuppression(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    email: string;
    reason: SuppressionReason;
    provider: string;
    errorCode: string | null;
    detail: string;
    suppressedBy: string | null;
    now: string;
  },
) {
  const result = await db.query<EmailSuppressionRow>(
    `insert into email_suppressions
       (id, tenant_id, email, reason, provider, error_code, detail,
        suppressed_by, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (tenant_id, email) do nothing
     returning *`,
    [
      input.id,
      input.tenantId,
      input.email,
      input.reason,
      input.provider,
      input.errorCode,
      input.detail,
      input.suppressedBy,
      input.now,
    ],
  );
  return result.rows[0] ?? null;
}

export async function deleteEmailSuppression(
  db: DbClient,
  tenantId: string,
  email: string,
) {
  const result = await db.query<{ id: string }>(
    `delete from email_suppressions
     where tenant_id = $1 and email = $2
     returning id`,
    [tenantId, email],
  );
  return result.rows[0]?.id ?? null;
}
