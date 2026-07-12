import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import { defaultGarageOnboarding } from "../src/lib/generation";
import { processPendingDomainEvents } from "../src/modules/workflows/worker";

const opened: Array<{ close: () => Promise<void> }> = [];

async function setup() {
  const db = await createMemoryDb();
  opened.push(db);
  return { db, services: createServices(db) };
}

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("vertical slice", () => {
  it("turns onboarding into a published site and a lead workflow", async () => {
    const { db, services } = await setup();
    const user = await services.registerUser({
      name: "Malia Occo",
      email: "malia@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(user.id, {
      name: "Garage Caraibes Auto",
      category: "Garage automobile",
    });

    await services.saveOnboarding(user.id, tenant.id, defaultGarageOnboarding());
    const workspace = await services.getWebsiteWorkspace(user.id, tenant.id);
    expect(workspace.website?.status).toBe("draft");
    expect(workspace.sections.length).toBeGreaterThan(5);

    const publicUrl = await services.publishWebsite(user.id, tenant.id);
    expect(publicUrl).toBe(`/sites/${tenant.slug}`);
    expect(await services.getPublishedSite(tenant.slug)).not.toBeNull();

    await services.submitPublicLead(tenant.slug, {
      name: "Jonathan Pelage",
      email: "jonathan@example.com",
      phone: "+596 696 11 22 33",
      message: "Je veux un devis pour la climatisation.",
    });
    await processPendingDomainEvents(db);

    const crm = await services.getCrm(user.id, tenant.id);
    const runs = await services.getWorkflowRuns(user.id, tenant.id);
    const audit = await services.getAuditLogs(user.id, tenant.id);

    expect(crm.contacts[0].email).toBe("jonathan@example.com");
    expect(crm.leads).toHaveLength(1);
    expect(crm.tasks[0].title).toContain("Relancer");
    expect(runs[0].status).toBe("succeeded");
    expect(audit.some((entry) => entry.action === "form.submitted")).toBe(true);
  });
});
