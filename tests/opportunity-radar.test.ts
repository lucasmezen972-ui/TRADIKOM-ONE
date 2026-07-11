import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { defaultGarageOnboarding } from "../src/lib/generation";
import { createServices } from "../src/lib/services";

const opened: Array<{ close: () => Promise<void> }> = [];

async function setup() {
  const db = await createMemoryDb();
  opened.push(db);
  return { db, services: createServices(db) };
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("opportunity radar", () => {
  it("detects typed alerts, isolates tenants, dismisses and resolves alerts", async () => {
    const { db, services } = await setup();
    const ownerA = await services.registerUser({
      name: "Malia Radar A",
      email: "malia.radar.a@example.com",
      password: "Password!1",
    });
    const ownerB = await services.registerUser({
      name: "Malia Radar B",
      email: "malia.radar.b@example.com",
      password: "Password!1",
    });
    const tenantA = await services.createTenant(ownerA.id, {
      name: "Garage Radar A",
      category: "Garage automobile",
    });
    const tenantB = await services.createTenant(ownerB.id, {
      name: "Garage Radar B",
      category: "Garage automobile",
    });
    await services.saveOnboarding(ownerA.id, tenantA.id, defaultGarageOnboarding());
    await services.saveOnboarding(ownerB.id, tenantB.id, defaultGarageOnboarding());
    await services.publishWebsite(ownerA.id, tenantA.id);
    await services.publishWebsite(ownerB.id, tenantB.id);
    await services.submitPublicLead(tenantA.slug, {
      name: "Client Radar A",
      email: "radar.a@example.com",
      phone: "+596 696 88 00 00",
      message: "Demande radar A",
    });
    await services.submitPublicLead(tenantA.slug, {
      name: "Client Radar B",
      email: "radar.b@example.com",
      phone: "0696 88 00 00",
      message: "Demande radar B",
    });

    const crm = await services.getCrm(ownerA.id, tenantA.id);
    const contact = crm.contacts.find(
      (item) => item.email === "radar.a@example.com",
    )!;
    const taskId = await services.createContactTask(
      ownerA.id,
      tenantA.id,
      contact.id,
      {
        title: "Relancer le client Radar",
        dueAt: "2000-01-01",
        assignedUserId: ownerA.id,
      },
    );
    await db.query(
      `update connectors
       set health = $1, status = $2
       where id in (
         select id from connectors where tenant_id = $3 limit 1
       )`,
      ["error", "Erreur", tenantA.id],
    );

    const alerts = await services.getOpportunityRadar(ownerA.id, tenantA.id);
    expect(alerts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          ruleKey: "overdue_task",
          actionHref: `/contacts/${contact.id}`,
          status: "active",
        }),
        expect.objectContaining({
          ruleKey: "connector_error",
          actionHref: "/connexions",
          status: "active",
        }),
        expect.objectContaining({
          ruleKey: "likely_duplicate_contact",
          actionHref: expect.stringContaining("/contacts/doublons/"),
          status: "active",
        }),
      ]),
    );

    const tenantBAlerts = await services.getOpportunityRadar(ownerB.id, tenantB.id);
    expect(
      tenantBAlerts.some((alert) => alert.entityId === taskId),
    ).toBe(false);

    const overdue = alerts.find((alert) => alert.ruleKey === "overdue_task")!;
    await services.dismissOpportunityRadarAlert(ownerA.id, tenantA.id, overdue.id);
    const dismissed = await services.getOpportunityRadar(ownerA.id, tenantA.id);
    expect(
      dismissed.find((alert) => alert.id === overdue.id)?.status,
    ).toBe("dismissed");

    await db.query("update tasks set status = $1 where tenant_id = $2 and id = $3", [
      "done",
      tenantA.id,
      taskId,
    ]);
    const resolved = await services.getOpportunityRadar(ownerA.id, tenantA.id);
    expect(resolved.some((alert) => alert.id === overdue.id)).toBe(false);

    const audit = await db.query<{ action: string; target_id: string }>(
      "select action, target_id from audit_logs where tenant_id = $1",
      [tenantA.id],
    );
    expect(audit.rows).toContainEqual({
      action: "opportunity_radar.dismissed",
      target_id: overdue.id,
    });
  });
});
