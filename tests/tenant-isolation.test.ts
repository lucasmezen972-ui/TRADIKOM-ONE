import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import { defaultGarageOnboarding } from "../src/lib/generation";

const opened: Array<{ close: () => Promise<void> }> = [];

async function setup() {
  const db = await createMemoryDb();
  opened.push(db);
  return { db, services: createServices(db) };
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("tenant isolation", () => {
  it("prevents a user from reading another tenant contact", async () => {
    const { services } = await setup();
    const ownerA = await services.registerUser({
      name: "Owner A",
      email: "a@example.com",
      password: "Password!1",
    });
    const ownerB = await services.registerUser({
      name: "Owner B",
      email: "b@example.com",
      password: "Password!1",
    });
    const tenantA = await services.createTenant(ownerA.id, {
      name: "Tenant A",
      category: "Services",
    });
    const tenantB = await services.createTenant(ownerB.id, {
      name: "Tenant B",
      category: "Services",
    });

    await services.saveOnboarding(ownerA.id, tenantA.id, defaultGarageOnboarding());
    await services.publishWebsite(ownerA.id, tenantA.id);
    await services.submitPublicLead(tenantA.slug, {
      name: "Client A",
      email: "client-a@example.com",
      phone: "+596 696 00 00 01",
      message: "Besoin de devis",
    });

    const crmA = await services.getCrm(ownerA.id, tenantA.id);
    expect(crmA.contacts).toHaveLength(1);
    await expect(
      services.findContactForTenant(ownerB.id, tenantA.id, crmA.contacts[0].id),
    ).rejects.toThrow("Acces refuse");
    await expect(services.getCrm(ownerA.id, tenantB.id)).rejects.toThrow(
      "Acces refuse",
    );
  });
});
