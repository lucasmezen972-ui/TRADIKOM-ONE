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
    // L'union est discriminée : le contenu marketing n'est lisible qu'après
    // avoir vérifié le module, ce que le compilateur impose.
    expect(
      current.revision?.module === "marketing" ? current.revision.content : null,
    ).toBe("Bonjour, votre entretien saisonnier peut etre planifie.");
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

describe("reputation revision", () => {
  async function setupPendingReview(suffix: string) {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const owner = await services.registerUser({
      name: `Owner Avis ${suffix}`,
      email: `owner.avis.${suffix}@example.com`,
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: `Garage Avis ${suffix}`,
      category: "Garage automobile",
    });
    await services.createReputationReview(owner.id, tenant.id, {
      source: "google",
      reviewerAlias: "Client mecontent",
      rating: 2,
      reviewText:
        "Attente trop longue et accueil decevant lors de mon dernier passage.",
      occurredAt: new Date().toISOString(),
    });
    await services.generateReputationProposals(owner.id, tenant.id);
    const workspace = await services.getReputationWorkspace(owner.id, tenant.id);
    const proposal = workspace.proposals[0]!;
    await services.submitReputationProposalForApproval(owner.id, tenant.id, {
      proposalId: proposal.id,
    });
    return { db, services, owner, tenant, proposal };
  }

  it("carries the customer-facing text and keeps the assessment out of reach", async () => {
    const { services, owner, tenant, proposal } =
      await setupPendingReview("contenu");

    const center = await services.getApprovalCenter(owner.id, tenant.id);
    const item = center.pending.find(
      (entry) => entry.kind === "reputation" && entry.targetId === proposal.id,
    )!;

    expect(item.revision).toMatchObject({
      module: "reputation",
      responseDraft: proposal.responseDraft,
      improvementPlan: proposal.improvementPlan,
    });
    // Ni le sentiment, ni la confiance, ni la justification ne sont exposés à
    // l'édition : ce sont des évaluations, pas de la rédaction.
    expect(item.revision).not.toHaveProperty("rationale");
    expect(item.revision).not.toHaveProperty("confidence");
  }, 60_000);

  it("replaces the pending response with the revised version", async () => {
    const { services, owner, tenant, proposal } =
      await setupPendingReview("remplacement");

    const revised = await services.reviseReputationProposal(owner.id, tenant.id, {
      proposalId: proposal.id,
      responseDraft:
        "Bonjour, merci pour votre retour. Nous vous rappelons cette semaine.",
      improvementPlan: "Revoir la planification des rendez-vous du samedi.",
    });
    expect(revised.version).toBeGreaterThan(proposal.version);
    expect(revised.awaitingDecision).toBe(true);

    const center = await services.getApprovalCenter(owner.id, tenant.id);
    const reputation = center.pending.filter(
      (entry) => entry.kind === "reputation",
    );
    expect(reputation.some((entry) => entry.targetId === proposal.id)).toBe(
      false,
    );
    const current = reputation.find(
      (entry) => entry.targetId === revised.proposalId,
    )!;
    expect(
      current.revision?.module === "reputation"
        ? current.revision.responseDraft
        : null,
    ).toBe("Bonjour, merci pour votre retour. Nous vous rappelons cette semaine.");
  }, 60_000);

  it("refuses to revise a response from another organisation", async () => {
    const first = await setupPendingReview("org-a");
    const second = await setupPendingReview("org-b");

    await expect(
      second.services.reviseReputationProposal(
        second.owner.id,
        second.tenant.id,
        {
          proposalId: first.proposal.id,
          responseDraft: "Tentative depuis une autre organisation entierement.",
          improvementPlan: "Aucun plan, cette revision ne doit pas aboutir.",
        },
      ),
    ).rejects.toMatchObject({ code: "reputation_proposal_not_found" });
  }, 60_000);
});

describe("website content revision", () => {
  async function setupPendingWebsiteProposal(suffix: string) {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const owner = await services.registerUser({
      name: `Owner Site ${suffix}`,
      email: `owner.site.${suffix}@example.com`,
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: `Garage Site ${suffix}`,
      category: "Garage automobile",
    });
    await services.saveOnboarding(owner.id, tenant.id, defaultGarageOnboarding());
    await services.generateWebsiteAiProposals(owner.id, tenant.id);
    const workspace = await services.getWebsiteAiWorkspace(owner.id, tenant.id);
    const proposal = workspace[0]!;
    await services.submitWebsiteAiProposalForApproval(owner.id, tenant.id, {
      proposalId: proposal.id,
    });
    return { db, services, owner, tenant, proposal };
  }

  it("carries the publishable copy and replaces the pending version", async () => {
    const { services, owner, tenant, proposal } =
      await setupPendingWebsiteProposal("contenu");

    const before = await services.getApprovalCenter(owner.id, tenant.id);
    const item = before.pending.find(
      (entry) => entry.kind === "website_ai" && entry.targetId === proposal.id,
    )!;
    expect(item.revision).toMatchObject({ module: "website_ai" });

    const revised = await services.reviseWebsiteAiProposal(owner.id, tenant.id, {
      proposalId: proposal.id,
      proposedTitle: "Entretien automobile a Fort-de-France",
      proposedBody:
        "Nous entretenons votre vehicule avec des pieces tracees et un devis clair.",
    });
    expect(revised.awaitingDecision).toBe(true);

    const after = await services.getApprovalCenter(owner.id, tenant.id);
    const website = after.pending.filter((entry) => entry.kind === "website_ai");
    expect(website.some((entry) => entry.targetId === proposal.id)).toBe(false);
    const current = website.find(
      (entry) => entry.targetId === revised.proposalId,
    )!;
    expect(
      current.revision?.module === "website_ai"
        ? current.revision.proposedTitle
        : null,
    ).toBe("Entretien automobile a Fort-de-France");
  }, 60_000);

  it("keeps the staleness guard after a revision", async () => {
    const { services, owner, tenant, proposal } =
      await setupPendingWebsiteProposal("obsolescence");

    const revised = await services.reviseWebsiteAiProposal(owner.id, tenant.id, {
      proposalId: proposal.id,
      proposedTitle: "Titre revu par le dirigeant",
      proposedBody: "Contenu revu par le dirigeant avant toute approbation.",
    });
    await services.decideWebsiteAiProposal(owner.id, tenant.id, {
      proposalId: revised.proposalId,
      decision: "approved",
      reason: "Contenu conforme apres relecture.",
    });

    // La section change entre l'approbation et l'application : la garde doit
    // toujours mordre, sinon reviser reviendrait a la desactiver.
    const workspace = await services.getWebsiteWorkspace(owner.id, tenant.id);
    const section = workspace.sections.find(
      (item) => item.id === proposal.sectionId,
    )!;
    await services.updateWebsiteSection(owner.id, tenant.id, section.id, {
      title: `${section.title} (modifie entre-temps)`,
      body: section.body,
      imageUrl: section.imageUrl,
      buttonLabel: section.buttonLabel,
      buttonHref: section.buttonHref,
      enabled: section.enabled,
    });

    const applied = await services.applyApprovedWebsiteAiProposal(
      owner.id,
      tenant.id,
      {
        proposalId: revised.proposalId,
      },
    );
    expect(applied).toMatchObject({ applied: false, stale: true });
  }, 60_000);
});
