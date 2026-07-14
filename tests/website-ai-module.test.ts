import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb, type DbClient } from "../src/lib/db";
import { defaultGarageOnboarding } from "../src/lib/generation";
import { safeJson } from "../src/lib/security";
import { createServices } from "../src/lib/services";
import { getDashboardData } from "../src/modules/dashboard";
import { applyApprovedWebsiteAiProposal } from "../src/modules/website-ai";

const opened: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("Website AI module", () => {
  it("applies an approved evidence-backed proposal to a reversible draft only", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const owner = await services.registerUser({
      name: "Website AI Owner",
      email: "website-ai-owner@example.com",
      password: "Password!1",
    });
    const outsider = await services.registerUser({
      name: "Website AI Outsider",
      email: "website-ai-outsider@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: "Website AI Garage",
      category: "Garage automobile",
    });
    await services.saveOnboarding(owner.id, tenant.id, defaultGarageOnboarding());
    await services.publishWebsite(owner.id, tenant.id);

    const initialWorkspace = await services.getWebsiteWorkspace(owner.id, tenant.id);
    const initialDraftVersionId = initialWorkspace.website?.currentDraftVersionId;
    const initialHero = initialWorkspace.sections.find((item) => item.type === "hero");
    const publishedBefore = await services.getPublishedSite(tenant.slug);
    const publishedHeroBefore = publishedBefore?.sections.find(
      (item) => item.type === "hero",
    );
    if (!initialDraftVersionId || !initialHero || !publishedHeroBefore) {
      throw new Error("Website AI fixture is incomplete.");
    }

    const generated = await services.generateWebsiteAiProposals(owner.id, tenant.id);
    expect(generated.createdIds).toHaveLength(2);
    const proposals = await services.getWebsiteAiWorkspace(owner.id, tenant.id);
    expect(proposals).toHaveLength(2);
    expect(
      proposals.every(
        (proposal) =>
          proposal.status === "proposed" &&
          proposal.evidence.length >= 2 &&
          proposal.rationale.length >= 10 &&
          proposal.riskSummary.includes("brouillon"),
      ),
    ).toBe(true);
    const seoProposal = proposals.find((item) => item.proposalType === "seo_copy");
    if (!seoProposal) throw new Error("Website AI SEO proposal is missing.");

    const repeated = await services.generateWebsiteAiProposals(owner.id, tenant.id);
    expect(repeated).toEqual({ createdIds: [], candidateCount: 2 });
    await services.submitWebsiteAiProposalForApproval(owner.id, tenant.id, {
      proposalId: seoProposal.id,
    });
    const dashboard = await getDashboardData(db, owner.id, tenant.id, {
      now: new Date("2026-07-14T16:00:00.000Z"),
      timeZone: "America/Martinique",
    });
    expect(
      dashboard.commandCenter.pendingApprovals.some(
        (item) =>
          item.approvalType === "website_ai" && item.actionHref === "/mon-site",
      ),
    ).toBe(true);

    await services.decideWebsiteAiProposal(owner.id, tenant.id, {
      proposalId: seoProposal.id,
      decision: "approved",
      reason: "Contenu factuel validé pour le prochain brouillon.",
    });
    const decisions = await db.query<{ decision: string; reason: string }>(
      `select decision, reason from website_ai_decisions
       where tenant_id = $1 and proposal_id = $2`,
      [tenant.id, seoProposal.id],
    );
    expect(decisions.rows).toEqual([
      {
        decision: "approved",
        reason: "Contenu factuel validé pour le prochain brouillon.",
      },
    ]);
    const approvals = await db.query<{ status: string }>(
      `select status from approvals
       where tenant_id = $1 and target_type = 'website_ai_proposal'
         and target_id = $2`,
      [tenant.id, seoProposal.id],
    );
    expect(approvals.rows).toEqual([{ status: "approved" }]);
    const publicationsBefore = await countPublications(db, tenant.id);
    const application = await services.applyApprovedWebsiteAiProposal(
      owner.id,
      tenant.id,
      { proposalId: seoProposal.id },
    );
    expect(application).toEqual({ applied: true, stale: false });

    const draft = await services.getWebsiteWorkspace(owner.id, tenant.id);
    expect(draft.website?.status).toBe("draft");
    expect(draft.sections.find((item) => item.id === initialHero.id)).toMatchObject({
      title: seoProposal.proposedTitle,
      body: seoProposal.proposedBody,
    });
    expect(draft.versions.some((version) => version.source === "manual_edit")).toBe(
      true,
    );
    const publishedAfter = await services.getPublishedSite(tenant.slug);
    expect(publishedAfter?.sections.find((item) => item.type === "hero")).toMatchObject({
      title: publishedHeroBefore.title,
      body: publishedHeroBefore.body,
    });
    expect(await countPublications(db, tenant.id)).toBe(publicationsBefore);
    const applied = await services.getWebsiteAiWorkspace(owner.id, tenant.id);
    expect(applied.find((item) => item.id === seoProposal.id)).toMatchObject({
      status: "applied",
      decisionReason: "Contenu factuel validé pour le prochain brouillon.",
    });

    const audit = await db.query<{ safe_metadata: string }>(
      `select safe_metadata from audit_logs
       where tenant_id = $1 and action = 'website_ai.proposal_applied_to_draft'
       order by created_at desc limit 1`,
      [tenant.id],
    );
    expect(safeJson(audit.rows[0]?.safe_metadata, {})).toMatchObject({
      publicationTriggered: false,
    });

    await services.restoreWebsiteVersion(owner.id, tenant.id, initialDraftVersionId);
    const restored = await services.getWebsiteWorkspace(owner.id, tenant.id);
    expect(restored.sections.find((item) => item.type === "hero")).toMatchObject({
      title: initialHero.title,
      body: initialHero.body,
    });

    await expect(
      services.getWebsiteAiWorkspace(outsider.id, tenant.id),
    ).rejects.toThrow("Acces refuse");
    await expect(
      services.generateWebsiteAiProposals(outsider.id, tenant.id),
    ).rejects.toThrow("Acces refuse");
  });

  it("marks an approved proposal stale instead of overwriting a newer human edit", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const owner = await services.registerUser({
      name: "Website AI Stale Owner",
      email: "website-ai-stale@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: "Website AI Stale Garage",
      category: "Garage automobile",
    });
    await services.saveOnboarding(owner.id, tenant.id, defaultGarageOnboarding());
    await services.generateWebsiteAiProposals(owner.id, tenant.id);
    const proposal = (await services.getWebsiteAiWorkspace(owner.id, tenant.id)).find(
      (item) => item.proposalType === "seo_copy",
    );
    const workspace = await services.getWebsiteWorkspace(owner.id, tenant.id);
    const section = workspace.sections.find((item) => item.id === proposal?.sectionId);
    if (!proposal || !section) throw new Error("Website AI stale fixture is missing.");

    await services.submitWebsiteAiProposalForApproval(owner.id, tenant.id, {
      proposalId: proposal.id,
    });
    await services.decideWebsiteAiProposal(owner.id, tenant.id, {
      proposalId: proposal.id,
      decision: "approved",
      reason: "Proposition relue avant modification humaine.",
    });
    const humanTitle = "Titre humain plus récent";
    await services.updateWebsiteSection(owner.id, tenant.id, section.id, {
      title: humanTitle,
      body: section.body,
      imageUrl: section.imageUrl,
      buttonLabel: section.buttonLabel,
      buttonHref: section.buttonHref,
      enabled: section.enabled,
    });

    const result = await services.applyApprovedWebsiteAiProposal(
      owner.id,
      tenant.id,
      { proposalId: proposal.id },
    );
    expect(result).toEqual({ applied: false, stale: true });
    const after = await services.getWebsiteWorkspace(owner.id, tenant.id);
    expect(after.sections.find((item) => item.id === section.id)?.title).toBe(
      humanTitle,
    );
    expect(
      (await services.getWebsiteAiWorkspace(owner.id, tenant.id)).find(
        (item) => item.id === proposal.id,
      ),
    ).toMatchObject({ status: "stale", decisionReason: undefined });
  });

  it("rolls back the draft snapshot when proposal finalization fails", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const owner = await services.registerUser({
      name: "Website AI Rollback Owner",
      email: "website-ai-rollback@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: "Website AI Rollback Garage",
      category: "Garage automobile",
    });
    await services.saveOnboarding(owner.id, tenant.id, defaultGarageOnboarding());
    await services.generateWebsiteAiProposals(owner.id, tenant.id);
    const proposal = (await services.getWebsiteAiWorkspace(owner.id, tenant.id)).find(
      (item) => item.proposalType === "seo_copy",
    );
    if (!proposal) throw new Error("Website AI rollback fixture is missing.");
    await services.submitWebsiteAiProposalForApproval(owner.id, tenant.id, {
      proposalId: proposal.id,
    });
    await services.decideWebsiteAiProposal(owner.id, tenant.id, {
      proposalId: proposal.id,
      decision: "approved",
      reason: "Validation de test avant injection d'une erreur.",
    });
    const before = await services.getWebsiteWorkspace(owner.id, tenant.id);
    const beforeSection = before.sections.find((item) => item.id === proposal.sectionId);
    if (!beforeSection) throw new Error("Website AI rollback section is missing.");

    const failingDb: DbClient = {
      query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => {
        if (sql.includes("set status = 'applied'")) {
          throw new Error("injected Website AI finalization failure");
        }
        return db.query<T>(sql, params);
      },
    };
    await expect(
      applyApprovedWebsiteAiProposal(failingDb, owner.id, tenant.id, {
        proposalId: proposal.id,
      }),
    ).rejects.toThrow("injected Website AI finalization failure");

    const after = await services.getWebsiteWorkspace(owner.id, tenant.id);
    expect(after.sections.find((item) => item.id === proposal.sectionId)).toMatchObject({
      title: beforeSection.title,
      body: beforeSection.body,
    });
    expect(after.versions).toHaveLength(before.versions.length);
    expect(
      (await services.getWebsiteAiWorkspace(owner.id, tenant.id)).find(
        (item) => item.id === proposal.id,
      ),
    ).toMatchObject({ status: "approved" });
  });
});

async function countPublications(
  db: Awaited<ReturnType<typeof createMemoryDb>>,
  tenantId: string,
) {
  const result = await db.query<{ count: number | string }>(
    "select count(*)::int as count from website_publications where tenant_id = $1",
    [tenantId],
  );
  return Number(result.rows[0]?.count ?? 0);
}
