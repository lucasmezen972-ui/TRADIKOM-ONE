import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb, type DbClient } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import { safeJson, toJson } from "../src/lib/security";
import { createPrivateAutomationPackage } from "../src/modules/automation-marketplace";
import type { WorkflowDefinition } from "../src/modules/workflows/types";

const opened: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("Automation Marketplace privé", () => {
  it("creates an idempotent value-free package and disabled preview", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const owner = await services.registerUser({
      name: "Automation Marketplace Owner",
      email: "automation-marketplace@example.com",
      password: "Password!1",
    });
    const outsider = await services.registerUser({
      name: "Automation Marketplace Outsider",
      email: "automation-marketplace-outsider@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: "Automation Marketplace Garage",
      category: "Garage automobile",
    });
    await services.refreshPrivateAppMarketplace(owner.id, tenant.id);
    const before = await countOperationalEffects(db, tenant.id);
    let workspace = await services.getAutomationMarketplace(owner.id, tenant.id);
    expect(workspace.sources).toHaveLength(1);
    const source = workspace.sources[0];
    if (!source) throw new Error("Automation marketplace source is missing.");

    const created = await services.createPrivateAutomationPackage(
      owner.id,
      tenant.id,
      { listingId: source.listingId },
    );
    expect(created).toMatchObject({ version: 1, created: true });
    expect(
      await services.createPrivateAutomationPackage(owner.id, tenant.id, {
        listingId: source.listingId,
      }),
    ).toEqual({ ...created, created: false });

    workspace = await services.getAutomationMarketplace(owner.id, tenant.id);
    expect(workspace.packages).toHaveLength(1);
    const automationPackage = workspace.packages[0];
    if (!automationPackage) throw new Error("Automation package is missing.");
    expect(automationPackage).toMatchObject({
      version: 1,
      visibility: "tenant_private",
      executionEnabled: false,
      preview: null,
      template: {
        sourceVersion: 1,
        trigger: "lead.created",
        active: false,
        conditionCount: 1,
        inputValuesIncluded: false,
      },
    });
    expect(automationPackage.requiredConfiguration).toEqual([
      "message",
      "summary",
      "title",
    ]);
    const serialized = JSON.stringify(automationPackage);
    expect(serialized).not.toContain("Relancer le nouveau lead");
    expect(serialized).not.toContain("Nouveau lead site a traiter");
    expect(serialized).not.toContain("payload.source");

    const preview = await services.previewPrivateAutomationPackage(
      owner.id,
      tenant.id,
      { packageId: automationPackage.id },
    );
    expect(preview).toMatchObject({ created: true, executionEnabled: false });
    expect(
      await services.previewPrivateAutomationPackage(owner.id, tenant.id, {
        packageId: automationPackage.id,
      }),
    ).toEqual({ ...preview, created: false });
    workspace = await services.getAutomationMarketplace(owner.id, tenant.id);
    expect(workspace.packages[0]?.preview).toMatchObject({
      installationMode: "preview_only",
      executionEnabled: false,
      permissionReview: {
        humanApprovalRequired: true,
        sourceInputValuesCopied: false,
        executionAllowed: false,
        externalSendAllowed: false,
        publicSharingAllowed: false,
      },
    });
    expect(await countOperationalEffects(db, tenant.id)).toEqual(before);

    await expect(
      services.getAutomationMarketplace(outsider.id, tenant.id),
    ).rejects.toThrow("Acces refuse");
    await expect(
      services.createPrivateAutomationPackage(outsider.id, tenant.id, {
        listingId: source.listingId,
      }),
    ).rejects.toThrow("Acces refuse");
  });

  it("versions a package when the source workflow version changes", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const owner = await services.registerUser({
      name: "Automation Version Owner",
      email: "automation-version@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: "Automation Version Garage",
      category: "Garage automobile",
    });
    await services.refreshPrivateAppMarketplace(owner.id, tenant.id);
    let workspace = await services.getAutomationMarketplace(owner.id, tenant.id);
    const sourceV1 = workspace.sources[0];
    if (!sourceV1) throw new Error("Automation source v1 is missing.");
    const packageV1 = await services.createPrivateAutomationPackage(
      owner.id,
      tenant.id,
      { listingId: sourceV1.listingId },
    );
    await services.previewPrivateAutomationPackage(owner.id, tenant.id, {
      packageId: packageV1.packageId,
    });
    const workflow = await db.query<{ id: string; definition: string }>(
      "select id, definition from workflows where tenant_id = $1 and status = 'active'",
      [tenant.id],
    );
    const definition = safeJson<WorkflowDefinition | null>(
      workflow.rows[0]?.definition,
      null,
    );
    if (!definition) throw new Error("Workflow version fixture is missing.");
    await db.query("update workflows set definition = $1 where tenant_id = $2 and id = $3", [
      toJson({
        ...definition,
        version: 2,
        actions: definition.actions.map((action, index) =>
          index === 0
            ? { ...action, input: { ...action.input, title: "VALEUR PRIVÉE V2" } }
            : action,
        ),
      }),
      tenant.id,
      workflow.rows[0]?.id,
    ]);
    await services.refreshPrivateAppMarketplace(owner.id, tenant.id);
    workspace = await services.getAutomationMarketplace(owner.id, tenant.id);
    const sourceV2 = workspace.sources[0];
    if (!sourceV2) throw new Error("Automation source v2 is missing.");
    expect(sourceV2.listingId).not.toBe(sourceV1.listingId);
    expect(
      await services.createPrivateAutomationPackage(owner.id, tenant.id, {
        listingId: sourceV2.listingId,
      }),
    ).toMatchObject({ version: 2, created: true });
    const current = (await services.getAutomationMarketplace(owner.id, tenant.id)).packages[0];
    expect(current).toMatchObject({ version: 2, preview: null });
    expect(JSON.stringify(current)).not.toContain("VALEUR PRIVÉE V2");
    const history = await db.query<{ record_status: string; version: number }>(
      `select record_status, version from automation_marketplace_packages
       where tenant_id = $1 order by version`,
      [tenant.id],
    );
    expect(history.rows).toEqual([
      { record_status: "superseded", version: 1 },
      { record_status: "current", version: 2 },
    ]);
  });

  it("rolls back package persistence when audit recording fails", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const owner = await services.registerUser({
      name: "Automation Rollback Owner",
      email: "automation-rollback@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: "Automation Rollback Garage",
      category: "Garage automobile",
    });
    await services.refreshPrivateAppMarketplace(owner.id, tenant.id);
    const source = (await services.getAutomationMarketplace(owner.id, tenant.id)).sources[0];
    if (!source) throw new Error("Automation rollback source is missing.");
    const failingDb: DbClient = {
      query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => {
        if (sql.includes("insert into audit_logs")) {
          throw new Error("injected automation marketplace audit failure");
        }
        return db.query<T>(sql, params);
      },
    };
    await expect(
      createPrivateAutomationPackage(failingDb, owner.id, tenant.id, {
        listingId: source.listingId,
      }),
    ).rejects.toThrow("injected automation marketplace audit failure");
    const rows = await db.query<{ count: number | string }>(
      "select count(*) as count from automation_marketplace_packages where tenant_id = $1",
      [tenant.id],
    );
    expect(Number(rows.rows[0]?.count ?? 0)).toBe(0);
  });
});

async function countOperationalEffects(
  db: Awaited<ReturnType<typeof createMemoryDb>>,
  tenantId: string,
) {
  const result = await db.query<{
    workflow_runs: number | string;
    events: number | string;
    notifications: number | string;
    activities: number | string;
    tasks: number | string;
  }>(
    `select
       (select count(*) from workflow_runs where tenant_id = $1) as workflow_runs,
       (select count(*) from domain_events where tenant_id = $1) as events,
       (select count(*) from notifications where tenant_id = $1) as notifications,
       (select count(*) from activities where tenant_id = $1) as activities,
       (select count(*) from tasks where tenant_id = $1) as tasks`,
    [tenantId],
  );
  return {
    workflowRuns: Number(result.rows[0]?.workflow_runs ?? 0),
    events: Number(result.rows[0]?.events ?? 0),
    notifications: Number(result.rows[0]?.notifications ?? 0),
    activities: Number(result.rows[0]?.activities ?? 0),
    tasks: Number(result.rows[0]?.tasks ?? 0),
  };
}
