import type { DbClient } from "@/lib/db";
import { toJson } from "@/lib/security";
import type { BusinessProfile } from "@/lib/types";

export async function upsertBusinessProfile(
  db: DbClient,
  input: {
    tenantId: string;
    profile: BusinessProfile;
    onboardingStep: number;
    completedAt: string;
    updatedAt: string;
  },
) {
  await db.query(
    `insert into business_profiles (tenant_id, data, onboarding_step, completed_at, updated_at)
     values ($1, $2, $3, $4, $5)
     on conflict (tenant_id) do update
     set data = excluded.data,
         onboarding_step = excluded.onboarding_step,
         completed_at = excluded.completed_at,
         updated_at = excluded.updated_at`,
    [
      input.tenantId,
      toJson(input.profile),
      input.onboardingStep,
      input.completedAt,
      input.updatedAt,
    ],
  );
}

export async function findBusinessProfileData(
  db: DbClient,
  tenantId: string,
) {
  const result = await db.query<{ data: string }>(
    "select data from business_profiles where tenant_id = $1",
    [tenantId],
  );

  return result.rows[0]?.data ?? null;
}
