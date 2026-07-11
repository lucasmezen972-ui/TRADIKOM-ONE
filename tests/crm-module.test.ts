import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { defaultGarageOnboarding } from "../src/lib/generation";
import { createServices } from "../src/lib/services";
import { findContactForTenant, getCrm } from "../src/modules/crm";

const opened: Array<{ close: () => Promise<void> }> = [];

async function setup() {
  const db = await createMemoryDb();
  opened.push(db);
  return { db, services: createServices(db) };
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("crm module", () => {
  it("returns tenant CRM data and protects contact lookup across tenants", async () => {
    const { db, services } = await setup();
    const ownerA = await services.registerUser({
      name: "Malia CRM A",
      email: "malia.crm.a@example.com",
      password: "Password!1",
    });
    const ownerB = await services.registerUser({
      name: "Malia CRM B",
      email: "malia.crm.b@example.com",
      password: "Password!1",
    });
    const tenantA = await services.createTenant(ownerA.id, {
      name: "Garage CRM A",
      category: "Garage automobile",
    });
    const tenantB = await services.createTenant(ownerB.id, {
      name: "Garage CRM B",
      category: "Garage automobile",
    });

    await services.saveOnboarding(ownerA.id, tenantA.id, defaultGarageOnboarding());
    await services.publishWebsite(ownerA.id, tenantA.id);
    await services.submitPublicLead(tenantA.slug, {
      name: "Client CRM",
      email: "client.crm@example.com",
      phone: "+596 696 44 55 66",
      message: "Demande CRM",
    });

    const crmA = await getCrm(db, ownerA.id, tenantA.id);
    expect(crmA.contacts[0]?.email).toBe("client.crm@example.com");
    expect(crmA.leads).toHaveLength(1);
    expect(crmA.tasks[0]?.title).toContain("Relancer");

    const contact = await findContactForTenant(
      db,
      ownerA.id,
      tenantA.id,
      crmA.contacts[0]!.id,
    );
    expect(contact?.email).toBe("client.crm@example.com");

    await expect(getCrm(db, ownerA.id, tenantB.id)).rejects.toThrow("Acces refuse");
    await expect(
      findContactForTenant(db, ownerB.id, tenantA.id, crmA.contacts[0]!.id),
    ).rejects.toThrow("Acces refuse");
  });
});
