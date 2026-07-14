import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb, type DbClient } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import { refreshPrivateAppMarketplace } from "../src/modules/app-marketplace";

const opened: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("App Marketplace privé", () => {
  it("versions real tenant artifacts and creates idempotent previews without side effects", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const owner = await services.registerUser({
      name: "Marketplace Owner",
      email: "marketplace-owner@example.com",
      password: "Password!1",
    });
    const outsider = await services.registerUser({
      name: "Marketplace Outsider",
      email: "marketplace-outsider@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: "Marketplace Garage",
      category: "Garage automobile",
    });
    const otherTenant = await services.createTenant(outsider.id, {
      name: "Marketplace Cabinet",
      category: "Conseil juridique",
    });
    const before = await countOperationalEffects(db, tenant.id);

    const refreshed = await services.refreshPrivateAppMarketplace(
      owner.id,
      tenant.id,
    );
    expect(refreshed).toEqual({
      sourceCount: 10,
      createdCount: 10,
      unchangedCount: 0,
    });
    expect(
      await services.refreshPrivateAppMarketplace(owner.id, tenant.id),
    ).toEqual({ sourceCount: 10, createdCount: 0, unchangedCount: 10 });

    let workspace = await services.getPrivateAppMarketplace(owner.id, tenant.id);
    expect(workspace.canManage).toBe(true);
    expect(workspace.listings).toHaveLength(10);
    expect(workspace.listings.filter((item) => item.category === "workflow")).toHaveLength(1);
    expect(workspace.listings.filter((item) => item.category === "ai_employee")).toHaveLength(9);
    expect(workspace.listings.every((item) => item.visibility === "private")).toBe(true);
    expect(JSON.stringify(workspace.listings)).not.toMatch(
      /password|encrypted_payload|access_token|refresh_token/i,
    );

    const listing = workspace.listings.find((item) => item.category === "workflow");
    if (!listing) throw new Error("Workflow marketplace fixture is missing.");
    const preview = await services.previewPrivateMarketplaceInstallation(
      owner.id,
      tenant.id,
      { listingId: listing.id },
    );
    expect(preview).toMatchObject({ created: true, enabled: false });
    expect(
      await services.previewPrivateMarketplaceInstallation(owner.id, tenant.id, {
        listingId: listing.id,
      }),
    ).toEqual({ ...preview, created: false });

    workspace = await services.getPrivateAppMarketplace(owner.id, tenant.id);
    const previewed = workspace.listings.find((item) => item.id === listing.id);
    expect(previewed?.preview).toMatchObject({
      status: "ready",
      installationMode: "preview_only",
      enabled: false,
      permissionReview: {
        humanApprovalRequired: true,
        externalExecutionAllowed: false,
        productionWritesAllowed: false,
        connectorActivationAllowed: false,
      },
    });
    expect(await countOperationalEffects(db, tenant.id)).toEqual(before);

    await expect(
      services.getPrivateAppMarketplace(outsider.id, tenant.id),
    ).rejects.toThrow("Acces refuse");
    await expect(
      services.previewPrivateMarketplaceInstallation(outsider.id, tenant.id, {
        listingId: listing.id,
      }),
    ).rejects.toThrow("Acces refuse");
    await expect(
      services.previewPrivateMarketplaceInstallation(owner.id, otherTenant.id, {
        listingId: listing.id,
      }),
    ).rejects.toThrow("Acces refuse");
  });

  it("supersedes only the changed source and preserves immutable previews", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const owner = await services.registerUser({
      name: "Marketplace Version Owner",
      email: "marketplace-version@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: "Marketplace Version Garage",
      category: "Garage automobile",
    });
    await services.refreshPrivateAppMarketplace(owner.id, tenant.id);
    const employees = await services.getAiEmployeeWorkspace(owner.id, tenant.id);
    const employee = employees.employees[0];
    if (!employee) throw new Error("AI employee marketplace fixture is missing.");
    const listing = (await services.getPrivateAppMarketplace(owner.id, tenant.id)).listings.find(
      (item) => item.listingKey === `ai-employee:${employee.employeeKey}`,
    );
    if (!listing) throw new Error("AI employee listing is missing.");
    await services.previewPrivateMarketplaceInstallation(owner.id, tenant.id, {
      listingId: listing.id,
    });
    await services.reviseAiEmployeeProfile(owner.id, tenant.id, {
      employeeId: employee.id,
      displayName: `${employee.displayName} révisé`,
      purpose: "Préparer une nouvelle version privée sans exécution externe.",
      status: "paused",
      workingDays: [1, 2, 3, 4, 5],
      workdayStart: "09:00",
      workdayEnd: "16:00",
    });

    expect(
      await services.refreshPrivateAppMarketplace(owner.id, tenant.id),
    ).toEqual({ sourceCount: 10, createdCount: 1, unchangedCount: 9 });
    const revised = (await services.getPrivateAppMarketplace(owner.id, tenant.id)).listings.find(
      (item) => item.listingKey === listing.listingKey,
    );
    expect(revised).toMatchObject({ version: 2, preview: null });
    expect(revised?.id).not.toBe(listing.id);

    const history = await db.query<{ record_status: string; version: number }>(
      `select record_status, version from private_marketplace_listings
       where tenant_id = $1 and listing_key = $2 order by version`,
      [tenant.id, listing.listingKey],
    );
    expect(history.rows).toEqual([
      { record_status: "superseded", version: 1 },
      { record_status: "current", version: 2 },
    ]);
    const previews = await db.query<{ listing_id: string; listing_version: number }>(
      `select listing_id, listing_version from marketplace_installation_previews
       where tenant_id = $1`,
      [tenant.id],
    );
    expect(previews.rows).toEqual([{ listing_id: listing.id, listing_version: 1 }]);
  });

  it("rolls back catalog writes when the audit checkpoint fails", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const owner = await services.registerUser({
      name: "Marketplace Rollback Owner",
      email: "marketplace-rollback@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: "Marketplace Rollback Garage",
      category: "Garage automobile",
    });
    const failingDb: DbClient = {
      query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => {
        if (sql.includes("insert into audit_logs")) {
          throw new Error("injected marketplace audit failure");
        }
        return db.query<T>(sql, params);
      },
    };

    await expect(
      refreshPrivateAppMarketplace(failingDb, owner.id, tenant.id),
    ).rejects.toThrow("injected marketplace audit failure");
    const listings = await db.query<{ count: number | string }>(
      "select count(*) as count from private_marketplace_listings where tenant_id = $1",
      [tenant.id],
    );
    expect(Number(listings.rows[0]?.count ?? 0)).toBe(0);
  });
});

async function countOperationalEffects(
  db: Awaited<ReturnType<typeof createMemoryDb>>,
  tenantId: string,
) {
  const result = await db.query<{
    accounts: number | string;
    credentials: number | string;
    domain_events: number | string;
    notifications: number | string;
    activities: number | string;
  }>(
    `select
       (select count(*) from connector_accounts where tenant_id = $1) as accounts,
       (select count(*) from connector_credentials where tenant_id = $1) as credentials,
       (select count(*) from domain_events where tenant_id = $1) as domain_events,
       (select count(*) from notifications where tenant_id = $1) as notifications,
       (select count(*) from activities where tenant_id = $1) as activities`,
    [tenantId],
  );
  return {
    accounts: Number(result.rows[0]?.accounts ?? 0),
    credentials: Number(result.rows[0]?.credentials ?? 0),
    domainEvents: Number(result.rows[0]?.domain_events ?? 0),
    notifications: Number(result.rows[0]?.notifications ?? 0),
    activities: Number(result.rows[0]?.activities ?? 0),
  };
}
