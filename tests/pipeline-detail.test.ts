import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { defaultGarageOnboarding } from "../src/lib/generation";
import { createServices } from "../src/lib/services";

const opened: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

async function setupPipeline(suffix: string) {
  const db = await createMemoryDb();
  opened.push(db);
  const services = createServices(db);
  const owner = await services.registerUser({
    name: `Owner Pipeline ${suffix}`,
    email: `owner.pipeline.${suffix}@example.com`,
    password: "Password!1",
  });
  const tenant = await services.createTenant(owner.id, {
    name: `Garage Pipeline ${suffix}`,
    category: "Garage automobile",
  });
  await services.saveOnboarding(owner.id, tenant.id, defaultGarageOnboarding());
  await services.publishWebsite(owner.id, tenant.id);
  await services.submitPublicLead(tenant.slug, {
    name: `Client Pipeline ${suffix}`,
    email: `client.pipeline.${suffix}@example.com`,
    phone: "+596 696 77 88 99",
    message: "Demande de devis pipeline",
  });
  const board = await services.getOpportunities(owner.id, tenant.id, {});
  return { db, services, owner, tenant, opportunity: board.opportunities[0]! };
}

describe("pipeline detail", () => {
  it("persists owner, probability and expected close date", async () => {
    const { services, owner, tenant, opportunity } =
      await setupPipeline("champs");

    expect(opportunity.assignedUserId).toBeUndefined();
    expect(opportunity.probability).toBeUndefined();
    expect(opportunity.expectedCloseAt).toBeUndefined();

    const updated = await services.updateOpportunity(
      owner.id,
      tenant.id,
      opportunity.id,
      {
        stageId: opportunity.stageId,
        valueCents: opportunity.valueCents,
        assignedUserId: owner.id,
        probability: 60,
        expectedCloseAt: "2026-09-30",
      },
    );

    expect(updated.assignedUserId).toBe(owner.id);
    expect(updated.probability).toBe(60);
    expect(updated.expectedCloseAt?.slice(0, 10)).toBe("2026-09-30");

    const detail = await services.getOpportunityDetail(
      owner.id,
      tenant.id,
      opportunity.id,
    );
    expect(detail?.opportunity.probability).toBe(60);
    expect(detail?.members.some((member) => member.id === owner.id)).toBe(true);
  }, 60_000);

  it("records only the fields that actually changed", async () => {
    const { services, owner, tenant, opportunity } =
      await setupPipeline("historique");

    await services.updateOpportunity(owner.id, tenant.id, opportunity.id, {
      stageId: opportunity.stageId,
      valueCents: opportunity.valueCents,
      nextFollowUpAt: opportunity.nextFollowUpAt,
      probability: 40,
    });

    const afterFirst = await services.getOpportunityDetail(
      owner.id,
      tenant.id,
      opportunity.id,
    );
    expect(afterFirst?.changes.map((change) => change.field)).toEqual([
      "probability",
    ]);
    expect(afterFirst?.changes[0]).toMatchObject({
      previousValue: null,
      nextValue: "40",
      changedByName: owner.name,
    });

    await services.updateOpportunity(owner.id, tenant.id, opportunity.id, {
      stageId: opportunity.stageId,
      valueCents: opportunity.valueCents,
      nextFollowUpAt: opportunity.nextFollowUpAt,
      probability: 75,
    });

    const afterSecond = await services.getOpportunityDetail(
      owner.id,
      tenant.id,
      opportunity.id,
    );
    expect(afterSecond?.changes).toHaveLength(2);
    expect(afterSecond?.changes[0]).toMatchObject({
      field: "probability",
      previousValue: "40",
      nextValue: "75",
    });

    // Une mise à jour sans modification réelle n'ajoute rien à l'historique.
    await services.updateOpportunity(owner.id, tenant.id, opportunity.id, {
      stageId: opportunity.stageId,
      valueCents: opportunity.valueCents,
      nextFollowUpAt: opportunity.nextFollowUpAt,
      probability: 75,
    });
    const afterNoop = await services.getOpportunityDetail(
      owner.id,
      tenant.id,
      opportunity.id,
    );
    expect(afterNoop?.changes).toHaveLength(2);
  }, 60_000);

  it("refuses an owner who does not belong to the organisation", async () => {
    const first = await setupPipeline("membre-a");
    const second = await setupPipeline("membre-b");

    await expect(
      first.services.updateOpportunity(
        first.owner.id,
        first.tenant.id,
        first.opportunity.id,
        {
          stageId: first.opportunity.stageId,
          valueCents: first.opportunity.valueCents,
          assignedUserId: second.owner.id,
        },
      ),
    ).rejects.toMatchObject({ code: "assignee_not_member" });

    const detail = await first.services.getOpportunityDetail(
      first.owner.id,
      first.tenant.id,
      first.opportunity.id,
    );
    expect(detail?.opportunity.assignedUserId).toBeUndefined();
    expect(
      detail?.members.some((member) => member.id === second.owner.id),
    ).toBe(false);
  }, 60_000);

  it("rejects a probability outside the 0-100 range", async () => {
    const { services, owner, tenant, opportunity } =
      await setupPipeline("bornes");

    await expect(
      services.updateOpportunity(owner.id, tenant.id, opportunity.id, {
        stageId: opportunity.stageId,
        valueCents: opportunity.valueCents,
        probability: 140,
      }),
    ).rejects.toThrow();
  }, 60_000);
});

describe("stage move", () => {
  it("records a stage change in the history and keeps the other fields", async () => {
    const { services, owner, tenant, opportunity } =
      await setupPipeline("deplacement");

    const board = await services.getOpportunities(owner.id, tenant.id, {});
    const target = board.stages.find((stage) => stage.name === "Devis envoye")!;

    await services.updateOpportunity(owner.id, tenant.id, opportunity.id, {
      stageId: opportunity.stageId,
      valueCents: opportunity.valueCents,
      nextFollowUpAt: opportunity.nextFollowUpAt,
      probability: 55,
      expectedCloseAt: "2026-10-15",
    });

    // Le déplacement reprend les valeurs existantes : rien d'autre ne bouge.
    const before = await services.getOpportunityDetail(
      owner.id,
      tenant.id,
      opportunity.id,
    );
    const current = before!.opportunity;
    await services.updateOpportunity(owner.id, tenant.id, opportunity.id, {
      stageId: target.id,
      valueCents: current.valueCents,
      nextFollowUpAt: current.nextFollowUpAt,
      lostReason: current.lostReason,
      assignedUserId: current.assignedUserId,
      probability: current.probability,
      expectedCloseAt: current.expectedCloseAt,
    });

    const after = await services.getOpportunityDetail(
      owner.id,
      tenant.id,
      opportunity.id,
    );
    expect(after!.opportunity.stageId).toBe(target.id);
    expect(after!.opportunity.probability).toBe(55);
    expect(after!.opportunity.expectedCloseAt?.slice(0, 10)).toBe("2026-10-15");

    const stageChange = after!.changes.find(
      (change) => change.field === "stage",
    )!;
    expect(stageChange.nextValue).toBe("Devis envoye");
    expect(stageChange.changedByName).toBe(owner.name);
  }, 60_000);
});

describe("stage reordering", () => {
  async function setupTwoOpportunities(suffix: string) {
    const first = await setupPipeline(`${suffix}-a`);
    // Un second lead dans la même organisation, donc la même colonne.
    await first.services.submitPublicLead(first.tenant.slug, {
      name: `Second Client ${suffix}`,
      email: `second.client.${suffix}@example.com`,
      phone: "+596 696 22 33 44",
      message: "Deuxieme demande de devis",
    });
    const board = await first.services.getOpportunities(
      first.owner.id,
      first.tenant.id,
      {},
    );
    return { ...first, board };
  }

  it("moves a card down and back up inside its column", async () => {
    const { services, owner, tenant, board } =
      await setupTwoOpportunities("ordre");
    expect(board.opportunities.length).toBeGreaterThanOrEqual(2);
    const initial = board.opportunities.map((item) => item.id);
    const top = initial[0]!;

    const moved = await services.reorderOpportunityInStage(owner.id, tenant.id, {
      opportunityId: top,
      direction: "down",
    });
    expect(moved).toEqual({ moved: true });

    const afterDown = await services.getOpportunities(owner.id, tenant.id, {});
    expect(afterDown.opportunities[1]?.id).toBe(top);

    await services.reorderOpportunityInStage(owner.id, tenant.id, {
      opportunityId: top,
      direction: "up",
    });
    const afterUp = await services.getOpportunities(owner.id, tenant.id, {});
    expect(afterUp.opportunities.map((item) => item.id)).toEqual(initial);
  }, 60_000);

  it("treats a move past the edge as a no-op, not an error", async () => {
    const { services, owner, tenant, board } =
      await setupTwoOpportunities("bord");
    const top = board.opportunities[0]!.id;

    // Déjà en haut : rien à faire, et surtout pas une erreur affichée.
    const result = await services.reorderOpportunityInStage(owner.id, tenant.id, {
      opportunityId: top,
      direction: "up",
    });
    expect(result).toEqual({ moved: false });

    const after = await services.getOpportunities(owner.id, tenant.id, {});
    expect(after.opportunities[0]?.id).toBe(top);
  }, 60_000);

  it("refuses to reorder an opportunity from another organisation", async () => {
    const first = await setupTwoOpportunities("org-a");
    const second = await setupPipeline("org-b");

    await expect(
      second.services.reorderOpportunityInStage(
        second.owner.id,
        second.tenant.id,
        { opportunityId: first.board.opportunities[0]!.id, direction: "down" },
      ),
    ).rejects.toMatchObject({ code: "opportunity_not_found" });
  }, 60_000);
});
