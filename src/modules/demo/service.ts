import type { DbClient } from "@/lib/db";
import { defaultGarageOnboarding } from "@/lib/generation";
import {
  findUserByEmail,
  mapUser,
  registerUser,
} from "@/modules/auth";
import {
  getBusinessTwin,
  saveBusinessTwin,
} from "@/modules/business-twin";
import { DemoError } from "@/modules/demo/errors";
import { tenantHasContacts } from "@/modules/demo/repository";
import {
  demoSeedSchema,
  type DemoSeedInput,
} from "@/modules/demo/schemas";
import { isDemoSeedEnabled } from "@/modules/demo/availability";
import { submitPublicLead } from "@/modules/crm";
import { enforceRateLimit, rateLimitPolicies } from "@/modules/rate-limit";
import { grantPlatformAdminForLocalSetup } from "@/modules/platform-admin";
import {
  createTenant,
  getUserTenants,
} from "@/modules/tenants";
import { createDefaultTenantResources } from "@/modules/tenants/provisioning";
import {
  getPublishedSite,
  publishWebsite,
} from "@/modules/websites";

export async function seedDemo(
  db: DbClient,
  input: DemoSeedInput = {},
  options: { environment?: Record<string, string | undefined> } = {},
) {
  if (!isDemoSeedEnabled(options.environment)) {
    throw new DemoError(
      "demo_disabled",
      "La demonstration locale est desactivee.",
    );
  }

  const parsed = demoSeedSchema.parse(input);
  await enforceRateLimit(db, {
    operationKey: "demo.seed",
    subjectKey: "shared-public-demo",
    scopeKey: process.env.NODE_ENV ?? "development",
    limit: rateLimitPolicies.publicDemo.limit,
    windowSeconds: rateLimitPolicies.publicDemo.windowSeconds,
  });

  const existing = await findUserByEmail(db, parsed.email);
  const user = existing
    ? mapUser(existing)
    : await registerUser(db, {
        name: parsed.name,
        email: parsed.email,
        password: parsed.password,
      });
  await grantPlatformAdminForLocalSetup(db, user.id);
  const tenants = await getUserTenants(db, user.id);
  const tenant =
    tenants[0]?.tenant ??
    (await createTenant(
      db,
      user.id,
      { name: parsed.tenantName, category: parsed.category },
      { createDefaults: createDefaultTenantResources },
    ));

  if (!tenant) {
    throw new DemoError(
      "demo_tenant_unavailable",
      "Organisation de demonstration indisponible.",
    );
  }

  const profile = await getBusinessTwin(db, user.id, tenant.id);
  if (!profile) {
    await saveBusinessTwin(db, user.id, tenant.id, defaultGarageOnboarding());
  }

  const publishedSite = await getPublishedSite(db, tenant.slug);
  if (!publishedSite) {
    await publishWebsite(db, user.id, tenant.id);
  }

  if (!(await tenantHasContacts(db, tenant.id))) {
    await submitPublicLead(
      db,
      tenant.slug,
      {
        name: "Jonathan Pelage",
        email: "jonathan.pelage@example.com",
        phone: "+596 696 11 22 33",
        message: "Bonjour, je souhaite un devis pour un diagnostic climatisation.",
      },
      { getPublishedSite },
    );
  }

  return { user, tenant, password: parsed.password };
}
