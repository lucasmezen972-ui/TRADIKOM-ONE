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

describe("crm opportunities", () => {
  it("updates opportunities and protects pipeline stages by tenant", async () => {
    const { db, services } = await setup();
    const ownerA = await services.registerUser({
      name: "Malia Opportunity A",
      email: "malia.opportunity.a@example.com",
      password: "Password!1",
    });
    const ownerB = await services.registerUser({
      name: "Malia Opportunity B",
      email: "malia.opportunity.b@example.com",
      password: "Password!1",
    });
    const tenantA = await services.createTenant(ownerA.id, {
      name: "Garage Opportunity A",
      category: "Garage automobile",
    });
    const tenantB = await services.createTenant(ownerB.id, {
      name: "Garage Opportunity B",
      category: "Garage automobile",
    });

    await services.saveOnboarding(ownerA.id, tenantA.id, defaultGarageOnboarding());
    await services.publishWebsite(ownerA.id, tenantA.id);
    await services.submitPublicLead(tenantA.slug, {
      name: "Client Opportunite",
      email: "client.opportunity@example.com",
      phone: "+596 696 44 55 88",
      message: "Demande opportunite CRM",
    });

    const board = await services.getOpportunities(ownerA.id, tenantA.id, {
      search: "client.opportunity",
    });
    expect(board.opportunities).toHaveLength(1);
    const opportunity = board.opportunities[0]!;
    const lostStage = board.stages.find((stage) => stage.name === "Perdu")!;

    const filtered = await services.getOpportunities(ownerA.id, tenantA.id, {
      stageId: opportunity.stageId,
    });
    expect(filtered.opportunities.map((item) => item.id)).toContain(opportunity.id);

    const updated = await services.updateOpportunity(
      ownerA.id,
      tenantA.id,
      opportunity.id,
      {
        stageId: lostStage.id,
        valueCents: 125000,
        nextFollowUpAt: "2026-07-20",
        lostReason: "Client deja equipe.",
      },
    );
    expect(updated.stageId).toBe(lostStage.id);
    expect(updated.valueCents).toBe(125000);
    expect(updated.lostReason).toBe("Client deja equipe.");

    const detail = await services.getOpportunityDetail(
      ownerA.id,
      tenantA.id,
      opportunity.id,
    );
    expect(detail?.opportunity.stageName).toBe("Perdu");
    expect(detail?.opportunity.nextFollowUpAt).toContain("2026-07-20");

    const contactDetail = await services.getContactDetail(
      ownerA.id,
      tenantA.id,
      opportunity.contactId,
    );
    expect(
      contactDetail?.activities.some(
        (activity) => activity.type === "opportunity.updated",
      ),
    ).toBe(true);

    const tenantBBoard = await services.getOpportunities(ownerB.id, tenantB.id);
    await expect(
      services.updateOpportunity(ownerA.id, tenantA.id, opportunity.id, {
        stageId: tenantBBoard.stages[0]!.id,
        valueCents: 1000,
        nextFollowUpAt: undefined,
        lostReason: undefined,
      }),
    ).rejects.toThrow("Etape de pipeline introuvable");
    await expect(
      services.updateOpportunity(ownerB.id, tenantA.id, opportunity.id, {
        stageId: lostStage.id,
        valueCents: 1000,
        nextFollowUpAt: undefined,
        lostReason: undefined,
      }),
    ).rejects.toThrow("Acces refuse");

    const audit = await db.query<{ action: string; target_id: string }>(
      "select action, target_id from audit_logs where tenant_id = $1",
      [tenantA.id],
    );
    expect(audit.rows).toContainEqual({
      action: "opportunity.updated",
      target_id: opportunity.id,
    });
  });
});
