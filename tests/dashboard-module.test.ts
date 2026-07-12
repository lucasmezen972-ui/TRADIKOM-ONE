import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { defaultGarageOnboarding } from "../src/lib/generation";
import { createServices } from "../src/lib/services";
import { getDashboardData } from "../src/modules/dashboard";

const opened: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("dashboard module", () => {
  it("keeps metrics tenant-scoped and rejects outsiders", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const firstOwner = await services.registerUser({
      name: "First Dashboard Owner",
      email: "first-dashboard-owner@example.com",
      password: "Password!1",
    });
    const secondOwner = await services.registerUser({
      name: "Second Dashboard Owner",
      email: "second-dashboard-owner@example.com",
      password: "Password!1",
    });
    const firstTenant = await services.createTenant(firstOwner.id, {
      name: "First Dashboard Garage",
      category: "Garage automobile",
    });
    const secondTenant = await services.createTenant(secondOwner.id, {
      name: "Second Dashboard Garage",
      category: "Garage automobile",
    });
    await services.saveOnboarding(
      firstOwner.id,
      firstTenant.id,
      defaultGarageOnboarding(),
    );
    await services.publishWebsite(firstOwner.id, firstTenant.id);
    await services.submitPublicLead(firstTenant.slug, {
      name: "Dashboard Lead",
      email: "dashboard-lead@example.com",
      phone: "0696000010",
      message: "Demande dashboard",
      idempotencyKey: "dashboard-module-lead",
    });

    const first = await getDashboardData(db, firstOwner.id, firstTenant.id);
    const second = await getDashboardData(db, secondOwner.id, secondTenant.id);

    expect(first.metrics).toMatchObject({
      newLeads: 1,
      contacts: 1,
      formSubmissions: 1,
    });
    expect(second.metrics).toMatchObject({
      newLeads: 0,
      contacts: 0,
      formSubmissions: 0,
    });
    await expect(
      getDashboardData(db, secondOwner.id, firstTenant.id),
    ).rejects.toThrow("Acces refuse");
  });
});
