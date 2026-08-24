import { withTenantDbTransaction } from "@/db/tenant-context";
import type { DbClient } from "@/lib/db";
import { nowIso } from "@/lib/security";
import type { ApprovalCenterData, Role } from "@/lib/types";
import { ApprovalCenterError } from "@/modules/approval-center/errors";
import {
  listPendingCompetitorApprovals,
  listPendingMarketingApprovals,
  listPendingReputationApprovals,
  listPendingStrategicApprovals,
  listPendingWebsiteAiApprovals,
  listRecentApprovalDecisions,
  listSnoozedApprovals,
  resumeApprovalRecord,
  snoozeApprovalRecord,
} from "@/modules/approval-center/repository";
import {
  approvalCenterQuerySchema,
  maxSnoozeDays,
  resumeApprovalSchema,
  snoozeApprovalSchema,
  type ApprovalCenterQueryInput,
  type ResumeApprovalInput,
  type SnoozeApprovalInput,
} from "@/modules/approval-center/schemas";
import { recordAuditLog } from "@/modules/audit";
import { findMembershipRole } from "@/modules/tenants/repository";

/**
 * Rôles autorisés à décider, alignés sur le tableau de bord : un collaborateur
 * ne doit jamais voir le contenu d'une décision qu'il ne peut pas prendre.
 */
const approvalRoles: Role[] = ["owner", "administrator", "manager"];

export async function getApprovalCenter(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: ApprovalCenterQueryInput = {},
): Promise<ApprovalCenterData> {
  const role = await findMembershipRole(db, userId, tenantId);
  if (!role) {
    throw new ApprovalCenterError(
      "approval_center_access_denied",
      "Accès refusé pour cette organisation.",
    );
  }
  const parsed = approvalCenterQuerySchema.parse(input);
  const canApprove = approvalRoles.includes(role);
  if (!canApprove) {
    return { canApprove: false, pending: [], snoozed: [], history: [] };
  }

  const now = nowIso();
  const [
    strategic,
    marketing,
    websiteAi,
    reputation,
    competitor,
    snoozed,
    history,
  ] = await Promise.all([
    listPendingStrategicApprovals(db, tenantId, now, parsed.pendingLimit),
    listPendingMarketingApprovals(db, tenantId, now, parsed.pendingLimit),
    listPendingWebsiteAiApprovals(db, tenantId, now, parsed.pendingLimit),
    listPendingReputationApprovals(db, tenantId, now, parsed.pendingLimit),
    listPendingCompetitorApprovals(db, tenantId, now, parsed.pendingLimit),
    listSnoozedApprovals(db, tenantId, now, parsed.pendingLimit),
    listRecentApprovalDecisions(db, tenantId, parsed.historyLimit),
  ]);

  const pending = [
    ...strategic,
    ...marketing,
    ...websiteAi,
    ...reputation,
    ...competitor,
  ]
    .sort((left, right) => left.requestedAt.localeCompare(right.requestedAt))
    .slice(0, parsed.pendingLimit);

  return { canApprove: true, pending, snoozed, history };
}

/**
 * Reporter n'est pas décider : la proposition reste en attente et revient
 * d'elle-même dans la file une fois l'échéance atteinte.
 */
export async function snoozeApproval(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: SnoozeApprovalInput,
) {
  const parsed = snoozeApprovalSchema.parse(input);
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertApprovalRole(transaction, userId, tenantId);

    const snoozedUntil = new Date(parsed.snoozedUntil);
    const now = new Date();
    const maxDate = new Date(
      now.getTime() + maxSnoozeDays * 24 * 60 * 60 * 1000,
    );
    if (snoozedUntil <= now || snoozedUntil > maxDate) {
      throw new ApprovalCenterError(
        "snooze_window_invalid",
        `La date de report doit être dans le futur et à moins de ${maxSnoozeDays} jours.`,
      );
    }

    const updated = await snoozeApprovalRecord(transaction, {
      tenantId,
      approvalId: parsed.approvalId,
      snoozedUntil: snoozedUntil.toISOString(),
      snoozedBy: userId,
      reason: parsed.reason?.trim() || null,
    });
    if (!updated) {
      throw new ApprovalCenterError(
        "approval_not_found",
        "Cette action n'est plus en attente.",
      );
    }

    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "approval.snoozed",
      targetType: "approval",
      targetId: parsed.approvalId,
      metadata: {
        snoozedUntil: snoozedUntil.toISOString(),
        hasReason: Boolean(parsed.reason?.trim()),
      },
    });

    return { snoozedUntil: snoozedUntil.toISOString() };
  });
}

export async function resumeApproval(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: ResumeApprovalInput,
) {
  const parsed = resumeApprovalSchema.parse(input);
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertApprovalRole(transaction, userId, tenantId);

    const updated = await resumeApprovalRecord(
      transaction,
      tenantId,
      parsed.approvalId,
    );
    if (!updated) {
      throw new ApprovalCenterError(
        "approval_not_found",
        "Cette action n'est plus en attente.",
      );
    }

    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "approval.resumed",
      targetType: "approval",
      targetId: parsed.approvalId,
      metadata: {},
    });

    return { resumed: true as const };
  });
}

async function assertApprovalRole(
  db: DbClient,
  userId: string,
  tenantId: string,
) {
  const role = await findMembershipRole(db, userId, tenantId);
  if (!role || !approvalRoles.includes(role)) {
    throw new ApprovalCenterError(
      "approval_center_access_denied",
      "Accès refusé pour cette organisation.",
    );
  }
}
