import type { DbClient } from "@/lib/db";
import { id, nowIso } from "@/lib/security";
import { withTenantDbTransaction } from "@/db/tenant-context";
import { recordAuditLog } from "@/modules/audit";
import { assertPlatformAdmin } from "@/modules/platform-admin";
import {
  findApiSourceById,
  findApprovedSoftwareDomain,
} from "@/modules/software-directory";
import { ApiSourceRecheckError } from "@/modules/api-intelligence/discovery/recheck/errors";
import { upsertApiSourceRecheckSchedule } from "@/modules/api-intelligence/discovery/recheck/repository";
import {
  apiSourceRecheckConfigurationSchema,
  type ApiSourceRecheckConfiguration,
} from "@/modules/api-intelligence/discovery/recheck/schemas";

export async function configureApiSourceRecheck(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: ApiSourceRecheckConfiguration,
) {
  const parsed = apiSourceRecheckConfigurationSchema.parse(input);

  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertPlatformAdmin(transaction, userId, tenantId);
    const source = await findApiSourceById(transaction, parsed.sourceId);
    if (!source) {
      throw new ApiSourceRecheckError(
        "source_not_found",
        "Source API introuvable.",
      );
    }
    if (parsed.enabled && source.source_classification !== "official") {
      throw new ApiSourceRecheckError(
        "source_not_official",
        "Seule une source officielle peut etre planifiee.",
      );
    }
    if (
      parsed.enabled &&
      !(await findApprovedSoftwareDomain(
        transaction,
        source.software_id,
        source.publisher_domain,
      ))
    ) {
      throw new ApiSourceRecheckError(
        "domain_not_approved",
        "Le domaine source doit etre approuve.",
      );
    }

    const configuredAt = nowIso();
    const nextRunAt = new Date(
      new Date(configuredAt).getTime() + parsed.intervalSeconds * 1_000,
    ).toISOString();
    const schedule = await upsertApiSourceRecheckSchedule(transaction, {
      id: id("recheck"),
      sourceId: parsed.sourceId,
      contextTenantId: tenantId,
      configuredBy: userId,
      enabled: parsed.enabled,
      intervalSeconds: parsed.intervalSeconds,
      nextRunAt,
      now: configuredAt,
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: parsed.enabled
        ? "api_intelligence.recheck_enabled"
        : "api_intelligence.recheck_disabled",
      targetType: "api_source_recheck_schedule",
      targetId: schedule.id,
      metadata: {
        sourceId: parsed.sourceId,
        intervalSeconds: parsed.intervalSeconds,
      },
    });

    return schedule;
  });
}
