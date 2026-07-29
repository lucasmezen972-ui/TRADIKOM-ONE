import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { defaultGarageOnboarding } from "../src/lib/generation";
import { createServices } from "../src/lib/services";

const opened: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

async function setupPendingMarketing(suffix: string) {
  const db = await createMemoryDb();
  opened.push(db);
  const services = createServices(db);
  const owner = await services.registerUser({
    name: `Owner Revision ${suffix}`,
    email: `owner.revision.${suffix}@example.com`,
    password: "Password!1",
  });
  const tenant = await services.createTenant(owner.id, {
    name: `Garage Revision ${suffix}`,
    category: "Garage automobile",
  });
  await services.saveOnboarding(owner.id, tenant.id, defaultGarageOnboarding());
  await services.generateMarketingCampaignProposals(owner.id, tenant.id);
  const proposals = await services.getAutonomousMarketing(owner.id, tenant.id);
  const proposal = proposals[0]!;
  await services.submitMarketingProposalForApproval(owner.id, tenant.id, {
    proposalId: proposal.id,
  });
  return { db, services, owner, tenant, proposal };
}

function draftFrom(proposal: {
  title: string;
  subject: string;
  objective: string;
  audience: string;
  content: string;
  callToAction: string;
  expectedOutcome: string;
  riskSummary: string;
}) {
  return {
    title: proposal.title,
    subject: proposal.subject,
    objective: proposal.objective,
    audience: proposal.audience,
    content: proposal.content,
    callToAction: proposal.callToAction,
    expectedOutcome: proposal.expectedOutcome,
    riskSummary: proposal.riskSummary,
    budgetCents: null,
    startsAt: null,
    endsAt: null,
  };
}

describe("approval center revision", () => {
  it("carries the editable content of a marketing proposal", async () => {
    const { services, owner, tenant, proposal } =
      await setupPendingMarketing("contenu");

    const center = await services.getApprovalCenter(owner.id, tenant.id);
    const item = center.pending.find(
      (entry) => entry.kind === "marketing" && entry.targetId === proposal.id,
    )!;

    expect(item.revision).toMatchObject({
      module: "marketing",
      channel: proposal.channel,
      title: proposal.title,
      audience: proposal.audience,
      content: proposal.content,
      callToAction: proposal.callToAction,
    });

    // Les autres modules n'exposent aucun brouillon : ils ne savent pas encore
    // réviser une proposition, et l'interface ne doit pas le laisser croire.
    for (const other of center.pending.filter(
      (entry) => entry.kind !== "marketing",
    )) {
      expect(other.revision).toBeUndefined();
    }
  }, 60_000);

  it("replaces the pending proposal with the revised version", async () => {
    const { services, owner, tenant, proposal } =
      await setupPendingMarketing("remplacement");

    const revised = await services.reviseMarketingProposal(owner.id, tenant.id, {
      ...draftFrom(proposal),
      proposalId: proposal.id,
      title: "Relance des entretiens saisonniers",
      content: "Bonjour, votre entretien saisonnier peut etre planifie.",
    });
    expect(revised.version).toBe(proposal.version + 1);
    // La proposition attendait une décision : la nouvelle version aussi.
    expect(revised.awaitingDecision).toBe(true);

    const center = await services.getApprovalCenter(owner.id, tenant.id);
    const marketing = center.pending.filter(
      (entry) => entry.kind === "marketing",
    );

    // L'ancienne version a disparu de la file, la nouvelle la remplace.
    expect(marketing.some((entry) => entry.targetId === proposal.id)).toBe(false);
    const current = marketing.find(
      (entry) => entry.targetId === revised.proposalId,
    )!;
    expect(current.title).toBe("Relance des entretiens saisonniers");
    expect(current.revision?.content).toBe(
      "Bonjour, votre entretien saisonnier peut etre planifie.",
    );
  }, 60_000);

  it("leaves an unsubmitted draft as a draft", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const owner = await services.registerUser({
      name: "Owner Revision Brouillon",
      email: "owner.revision.brouillon@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: "Garage Revision Brouillon",
      category: "Garage automobile",
    });
    await services.saveOnboarding(owner.id, tenant.id, defaultGarageOnboarding());
    await services.generateMarketingCampaignProposals(owner.id, tenant.id);
    const proposals = await services.getAutonomousMarketing(owner.id, tenant.id);
    const draft = proposals[0]!;

    // Jamais soumise : corriger un brouillon ne le met pas dans la file.
    const revised = await services.reviseMarketingProposal(owner.id, tenant.id, {
      ...draftFrom(draft),
      proposalId: draft.id,
      title: "Brouillon relu avant soumission",
    });
    expect(revised.awaitingDecision).toBe(false);

    const center = await services.getApprovalCenter(owner.id, tenant.id);
    expect(
      center.pending.some((entry) => entry.targetId === revised.proposalId),
    ).toBe(false);
  }, 60_000);

  it("refuses a revision from another organisation", async () => {
    const first = await setupPendingMarketing("org-a");
    const second = await setupPendingMarketing("org-b");

    await expect(
      second.services.reviseMarketingProposal(second.owner.id, second.tenant.id, {
        ...draftFrom(first.proposal),
        proposalId: first.proposal.id,
        title: "Tentative depuis une autre organisation",
      }),
    ).rejects.toMatchObject({ code: "marketing_proposal_not_found" });

    // La proposition de la première organisation est intacte.
    const center = await first.services.getApprovalCenter(
      first.owner.id,
      first.tenant.id,
    );
    expect(
      center.pending.some((entry) => entry.targetId === first.proposal.id),
    ).toBe(true);
  }, 60_000);
});
