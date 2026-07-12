import { withTenantDbTransaction } from "@/db/tenant-context";
import type { DbClient } from "@/lib/db";
import { buildBusinessTwin } from "@/lib/generation";
import { nowIso, safeJson } from "@/lib/security";
import type { BusinessProfile } from "@/lib/types";
import { recordAuditLog } from "@/modules/audit";
import { BusinessTwinError } from "@/modules/business-twin/errors";
import {
  findBusinessProfileData,
  upsertBusinessProfile,
} from "@/modules/business-twin/repository";
import {
  onboardingSchema,
  type OnboardingInput,
} from "@/modules/business-twin/schemas";
import { assertTenantAccess } from "@/modules/tenants";
import { generateOrReplaceWebsite } from "@/modules/websites";

export async function saveBusinessTwin(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: OnboardingInput,
) {
  const parsed = onboardingSchema.parse(input);
  const profile = buildBusinessTwin(parsed);

  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [
      "owner",
      "administrator",
      "manager",
    ]);
    const now = nowIso();

    await upsertBusinessProfile(transaction, {
      tenantId,
      profile,
      onboardingStep: 4,
      completedAt: now,
      updatedAt: now,
    });
    await generateOrReplaceWebsite(transaction, tenantId, profile);
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "onboarding.completed",
      targetType: "business_profile",
      targetId: tenantId,
      metadata: { category: profile.identity.category },
    });

    return profile;
  });
}

export async function getBusinessTwin(
  db: DbClient,
  userId: string,
  tenantId: string,
) {
  await assertTenantAccess(db, userId, tenantId);
  const data = await findBusinessProfileData(db, tenantId);
  if (!data) return null;

  const profile = safeJson<BusinessProfile | null>(data, null);
  if (!profile) {
    throw new BusinessTwinError(
      "business_profile_invalid",
      "Le profil entreprise est invalide.",
    );
  }

  return profile;
}
