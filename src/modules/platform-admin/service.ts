import type { DbClient } from "@/lib/db";
import { PlatformAdminError } from "@/modules/platform-admin/errors";
import {
  findPlatformRole,
  setPlatformRole,
} from "@/modules/platform-admin/repository";
import { assertTenantAccess } from "@/modules/tenants";

export async function isPlatformAdmin(db: DbClient, userId: string) {
  return (await findPlatformRole(db, userId)) === "platform_admin";
}

export async function assertPlatformAdmin(
  db: DbClient,
  userId: string,
  tenantId?: string,
) {
  if (tenantId) {
    await assertTenantAccess(db, userId, tenantId, ["owner", "administrator"]);
  }
  if (!(await isPlatformAdmin(db, userId))) {
    throw new PlatformAdminError(
      "platform_admin_required",
      "Un administrateur plateforme est requis.",
    );
  }
}

export async function grantPlatformAdminForLocalSetup(
  db: DbClient,
  userId: string,
) {
  if (process.env.NODE_ENV === "production") {
    throw new PlatformAdminError(
      "platform_role_invalid",
      "Attribution de role plateforme indisponible.",
    );
  }
  await setPlatformRole(db, userId, "platform_admin");
}
