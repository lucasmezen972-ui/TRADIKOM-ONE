import type { DbClient } from "@/lib/db";
import { id, nowIso } from "@/lib/security";
import { recordAuditLog } from "@/modules/audit";
import { EmailSuppressionError } from "@/modules/email-suppression/errors";
import {
  findEmailSuppression,
  insertEmailSuppression,
} from "@/modules/email-suppression/repository";
import {
  suppressEmailSchema,
  type SuppressEmailInput,
} from "@/modules/email-suppression/schemas";

export function normalizeSuppressionEmail(value: string) {
  return value.trim().toLowerCase();
}

/**
 * Vérifié avant chaque envoi d'invitation. Un envoi vers une adresse dont la
 * livraison a définitivement échoué ne peut pas aboutir, et l'insistance abîme
 * la réputation du domaine d'expédition pour toutes les organisations.
 */
export async function assertEmailNotSuppressed(
  db: DbClient,
  tenantId: string,
  email: string,
) {
  const suppression = await findEmailSuppression(
    db,
    tenantId,
    normalizeSuppressionEmail(email),
  );
  if (suppression) {
    throw new EmailSuppressionError(
      "email_suppressed",
      "Cette adresse est bloquée : un envoi précédent a définitivement échoué. Vérifiez l'adresse, puis réautorisez-la dans les paramètres.",
    );
  }
}

export async function isEmailSuppressed(
  db: DbClient,
  tenantId: string,
  email: string,
) {
  const suppression = await findEmailSuppression(
    db,
    tenantId,
    normalizeSuppressionEmail(email),
  );
  return suppression !== null;
}

/**
 * Enregistre une suppression sans transaction propre : l'appelant est déjà
 * dans le contexte tenant de l'envoi qui vient d'échouer.
 */
export async function suppressEmail(
  db: DbClient,
  tenantId: string,
  input: SuppressEmailInput,
  actorId: string | null = null,
) {
  const parsed = suppressEmailSchema.parse(input);
  const inserted = await insertEmailSuppression(db, {
    id: id("email_suppression"),
    tenantId,
    email: parsed.email,
    reason: parsed.reason,
    provider: parsed.provider,
    errorCode: parsed.errorCode ?? null,
    detail: parsed.detail,
    suppressedBy: actorId,
    now: nowIso(),
  });
  if (!inserted) {
    // L'adresse était déjà bloquée : rien de neuf à tracer.
    return null;
  }

  await recordAuditLog(db, {
    tenantId,
    actorId: actorId ?? "system",
    action: "email.suppressed",
    targetType: "email_suppression",
    targetId: inserted.id,
    metadata: {
      reason: parsed.reason,
      provider: parsed.provider,
      errorCode: parsed.errorCode ?? null,
    },
  });
  return inserted;
}
