import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import { setPlatformRole } from "../src/modules/platform-admin";
import { PlatformAdminError } from "../src/modules/platform-admin/errors";

const databases: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("API Intelligence observability", () => {
  it("reports bounded global and tenant health without source details", async () => {
    const db = await createMemoryDb();
    databases.push(db);
    const services = createServices(db);
    const admin = await services.registerUser({
      name: "Admin observabilite",
      email: "observability-admin@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(admin.id, {
      name: "Tenant observabilite",
      category: "Services",
    });
    await setPlatformRole(db, admin.id, "platform_admin");

    const empty = await services.getApiIntelligenceObservability(
      admin.id,
      tenant.id,
      new Date("2026-07-14T02:00:00.000Z"),
    );
    expect(empty).toMatchObject({
      status: "healthy",
      global: {
        approvedDomains: 0,
        officialSources: 0,
        blockedRechecks: 0,
      },
      tenant: {
        blockedImpacts: 0,
        failedContracts24h: 0,
      },
    });

    const software = await services.createSoftwareDirectoryEntry(
      admin.id,
      tenant.id,
      {
        canonicalName: "Observability Cloud",
        aliases: [],
        vendor: "Observability SAS",
        officialDomain: "docs.observability.test",
        supportedRegions: ["Europe"],
        languages: ["fr"],
        industries: ["Services"],
        categories: ["Operations"],
        officialWebsite: "https://docs.observability.test/",
      },
    );
    await services.decideSoftwareDomain(admin.id, tenant.id, {
      domainId: software.domainId,
      status: "approved",
      reason: "Domaine officiel verifie.",
    });
    const product = await services.createApiProductRecord(admin.id, tenant.id, {
      softwareId: software.softwareId,
      name: "Observability API",
      apiStyle: "rest",
      version: "1",
      documentationUrl: "https://docs.observability.test/openapi.json",
    });
    const source = await services.addOfficialApiSource(admin.id, tenant.id, {
      softwareId: software.softwareId,
      apiProductId: product.apiProductId,
      url: "https://docs.observability.test/openapi.json",
      sourceType: "official_openapi_specification",
    });
    await services.configureApiSourceRecheck(admin.id, tenant.id, {
      sourceId: source.sourceId,
      enabled: true,
      intervalSeconds: 3_600,
    });
    await db.query(
      `update api_source_recheck_schedules
       set enabled = 0, last_status = 'blocked',
           last_error_code = 'domain_not_approved'
       where source_id = $1`,
      [source.sourceId],
    );

    const observed = await services.getApiIntelligenceObservability(
      admin.id,
      tenant.id,
      new Date("2026-07-14T02:00:00.000Z"),
    );
    expect(observed).toMatchObject({
      status: "critical",
      global: {
        approvedDomains: 1,
        officialSources: 1,
        scheduledSources: 0,
        blockedRechecks: 1,
      },
    });
    const serialized = JSON.stringify(observed);
    expect(serialized).not.toContain("docs.observability.test");
    expect(serialized).not.toContain("domain_not_approved");

    const otherTenant = await services.createTenant(admin.id, {
      name: "Autre tenant observabilite",
      category: "Conseil",
    });
    const other = await services.getApiIntelligenceObservability(
      admin.id,
      otherTenant.id,
      new Date("2026-07-14T02:00:00.000Z"),
    );
    expect(other.global).toEqual(observed.global);
    expect(other.tenant).toMatchObject({
      pendingMappings: 0,
      blockedImpacts: 0,
      generatedRepairs: 0,
      failedContracts24h: 0,
    });
  });

  it("rejects observability access without the platform role", async () => {
    const db = await createMemoryDb();
    databases.push(db);
    const services = createServices(db);
    const owner = await services.registerUser({
      name: "Owner observabilite",
      email: "observability-owner@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: "Tenant prive",
      category: "Services",
    });
    await expect(
      services.getApiIntelligenceObservability(owner.id, tenant.id),
    ).rejects.toBeInstanceOf(PlatformAdminError);
  });
});
