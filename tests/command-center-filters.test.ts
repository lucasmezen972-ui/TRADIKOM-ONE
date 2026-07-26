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

async function provisionTenantWithLead(
  services: ReturnType<typeof createServices>,
  suffix: string,
) {
  const owner = await services.registerUser({
    name: `Owner Filtres ${suffix}`,
    email: `owner.filtres.${suffix}@example.com`,
    password: "Password!1",
  });
  const tenant = await services.createTenant(owner.id, {
    name: `Garage Filtres ${suffix}`,
    category: "Garage automobile",
  });
  await services.saveOnboarding(owner.id, tenant.id, defaultGarageOnboarding());
  await services.publishWebsite(owner.id, tenant.id);
  await services.submitPublicLead(tenant.slug, {
    name: `Client Filtres ${suffix}`,
    email: `client.filtres.${suffix}@example.com`,
    phone: "+596 696 11 22 33",
    message: "Demande de devis filtres",
  });
  return { owner, tenant };
}

describe("command center filtered views", () => {
  it("filters overdue open tasks with the taches-en-retard view", async () => {
    const { services } = await setup();
    const { owner, tenant } = await provisionTenantWithLead(services, "taches");

    const crm = await services.getCrm(owner.id, tenant.id);
    const contact = crm.contacts.find(
      (item) => item.email === "client.filtres.taches@example.com",
    )!;

    await services.createContactTask(owner.id, tenant.id, contact.id, {
      title: "Relance en retard",
      dueAt: "2020-01-05T10:00:00.000Z",
    });
    await services.createContactTask(owner.id, tenant.id, contact.id, {
      title: "Relance planifiée",
      dueAt: "2099-01-05T10:00:00.000Z",
    });

    const overdueView = await services.getCrm(owner.id, tenant.id, {
      view: "taches-en-retard",
    });
    expect(overdueView.view).toBe("taches-en-retard");
    expect(
      overdueView.tasks.some((task) => task.title === "Relance en retard"),
    ).toBe(true);
    expect(
      overdueView.tasks.some((task) => task.title === "Relance planifiée"),
    ).toBe(false);
    expect(overdueView.tasks.every((task) => task.status === "open")).toBe(true);

    const defaultView = await services.getCrm(owner.id, tenant.id);
    expect(
      defaultView.tasks.some((task) => task.title === "Relance planifiée"),
    ).toBe(true);
  });

  it("filters today's leads with the nouveaux-leads view", async () => {
    const { services } = await setup();
    const { owner, tenant } = await provisionTenantWithLead(services, "leads");

    const todayView = await services.getCrm(owner.id, tenant.id, {
      view: "nouveaux-leads",
    });
    expect(todayView.leads.length).toBeGreaterThan(0);

    const futureDayView = await services.getCrm(owner.id, tenant.id, {
      view: "nouveaux-leads",
      now: new Date("2099-06-15T12:00:00.000Z"),
    });
    expect(futureDayView.leads).toHaveLength(0);

    const defaultView = await services.getCrm(owner.id, tenant.id, {
      now: new Date("2099-06-15T12:00:00.000Z"),
    });
    expect(defaultView.leads.length).toBeGreaterThan(0);
  });

  it("filters opportunities needing follow-up and excludes closed stages", async () => {
    const { services } = await setup();
    const { owner, tenant } = await provisionTenantWithLead(services, "relance");

    const board = await services.getOpportunities(owner.id, tenant.id, {});
    expect(board.opportunities).toHaveLength(1);
    const opportunity = board.opportunities[0]!;

    const beforeFollowUp = await services.getOpportunities(owner.id, tenant.id, {
      followUpDue: true,
    });
    expect(
      beforeFollowUp.opportunities.map((item) => item.id),
    ).not.toContain(opportunity.id);

    await services.updateOpportunity(owner.id, tenant.id, opportunity.id, {
      stageId: opportunity.stageId,
      valueCents: opportunity.valueCents,
      nextFollowUpAt: "2020-02-01T09:00:00.000Z",
    });

    const dueFollowUp = await services.getOpportunities(owner.id, tenant.id, {
      followUpDue: true,
    });
    expect(dueFollowUp.opportunities.map((item) => item.id)).toContain(
      opportunity.id,
    );

    const lostStage = board.stages.find((stage) => stage.name === "Perdu")!;
    await services.updateOpportunity(owner.id, tenant.id, opportunity.id, {
      stageId: lostStage.id,
      valueCents: opportunity.valueCents,
      nextFollowUpAt: "2020-02-01T09:00:00.000Z",
      lostReason: "Projet abandonné.",
    });

    const afterLost = await services.getOpportunities(owner.id, tenant.id, {
      followUpDue: true,
    });
    expect(afterLost.opportunities.map((item) => item.id)).not.toContain(
      opportunity.id,
    );
  });

  it("keeps filtered views isolated between tenants", async () => {
    const { services } = await setup();
    const tenantA = await provisionTenantWithLead(services, "iso-a");
    const tenantB = await provisionTenantWithLead(services, "iso-b");

    const crmA = await services.getCrm(tenantA.owner.id, tenantA.tenant.id);
    const contactA = crmA.contacts.find(
      (item) => item.email === "client.filtres.iso-a@example.com",
    )!;
    await services.createContactTask(
      tenantA.owner.id,
      tenantA.tenant.id,
      contactA.id,
      {
        title: "Tâche en retard tenant A",
        dueAt: "2020-01-05T10:00:00.000Z",
      },
    );

    const overdueB = await services.getCrm(tenantB.owner.id, tenantB.tenant.id, {
      view: "taches-en-retard",
    });
    expect(
      overdueB.tasks.some((task) => task.title === "Tâche en retard tenant A"),
    ).toBe(false);

    const followUpB = await services.getOpportunities(
      tenantB.owner.id,
      tenantB.tenant.id,
      { followUpDue: true },
    );
    expect(
      followUpB.opportunities.every(
        (item) => item.tenantId === tenantB.tenant.id,
      ),
    ).toBe(true);

    await expect(
      services.getCrm(tenantB.owner.id, tenantA.tenant.id, {
        view: "taches-en-retard",
      }),
    ).rejects.toThrow();
  });
});
