import type { DbClient } from "@/lib/db";
import type { ApprovalCenterData, Role } from "@/lib/types";
import { ApprovalCenterError } from "@/modules/approval-center/errors";
import {
  listPendingCompetitorApprovals,
  listPendingMarketingApprovals,
  listPendingReputationApprovals,
  listPendingStrategicApprovals,
  listPendingWebsiteAiApprovals,
  listRecentApprovalDecisions,
} from "@/modules/approval-center/repository";
import {
  approvalCenterQuerySchema,
  type ApprovalCenterQueryInput,
} from "@/modules/approval-center/schemas";
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
    return { canApprove: false, pending: [], history: [] };
  }

  const [strategic, marketing, websiteAi, reputation, competitor, history] =
    await Promise.all([
      listPendingStrategicApprovals(db, tenantId, parsed.pendingLimit),
      listPendingMarketingApprovals(db, tenantId, parsed.pendingLimit),
      listPendingWebsiteAiApprovals(db, tenantId, parsed.pendingLimit),
      listPendingReputationApprovals(db, tenantId, parsed.pendingLimit),
      listPendingCompetitorApprovals(db, tenantId, parsed.pendingLimit),
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

  return { canApprove: true, pending, history };
}
