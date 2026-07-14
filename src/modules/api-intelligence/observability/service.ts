import type { DbClient } from "@/lib/db";
import { readApiIntelligenceObservability } from "@/modules/api-intelligence/observability/repository";
import { assertPlatformAdmin } from "@/modules/platform-admin";

export async function getApiIntelligenceObservability(
  db: DbClient,
  userId: string,
  tenantId: string,
  now = new Date(),
) {
  await assertPlatformAdmin(db, userId, tenantId);
  const snapshot = await readApiIntelligenceObservability(db, tenantId, now);
  const status =
    snapshot.global.blockedRechecks > 0 ||
    snapshot.tenant.failedContracts24h > 0
      ? "critical"
      : snapshot.global.retryingRechecks > 0 ||
          snapshot.global.dueRechecks > 0 ||
          snapshot.global.pendingCandidates > 0 ||
          snapshot.global.pendingClaims > 0 ||
          snapshot.tenant.pendingMappings > 0 ||
          snapshot.tenant.pendingRepairDecisions > 0 ||
          snapshot.tenant.pendingSandboxApprovals > 0
        ? "attention"
        : "healthy";
  return { ...snapshot, status };
}
