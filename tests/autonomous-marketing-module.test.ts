import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { defaultGarageOnboarding } from "../src/lib/generation";
import { safeJson } from "../src/lib/security";
import { createServices } from "../src/lib/services";
import { getDashboardData } from "../src/modules/dashboard";

const opened: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("autonomous marketing module", () => {
  it("prepares evidence-backed drafts and approves planning without execution", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const owner = await services.registerUser({
      name: "Marketing Owner",
      email: "marketing-owner@example.com",
      password: "Password!1",
    });
    const outsider = await services.registerUser({
      name: "Marketing Outsider",
      email: "marketing-outsider@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: "Marketing Garage",
      category: "Garage automobile",
    });
    await services.saveOnboarding(owner.id, tenant.id, defaultGarageOnboarding());

    const generation = await services.generateMarketingCampaignProposals(
      owner.id,
      tenant.id,
    );
    expect(generation).toMatchObject({ candidateCount: 2 });
    expect(generation.createdIds).toHaveLength(2);

    const proposals = await services.getAutonomousMarketing(owner.id, tenant.id);
    expect(proposals).toHaveLength(2);
    expect(proposals.map((item) => item.channel).sort()).toEqual([
      "email",
      "social",
    ]);
    expect(
      proposals.every(
        (item) =>
          item.status === "draft" &&
          item.version === 1 &&
          item.evidence.length === 3 &&
          item.evidence.every((evidence) => evidence.type === "business_profile"),
      ),
    ).toBe(true);
    const combinedContent = proposals.map((item) => item.content).join(" ").toLowerCase();
    expect(combinedContent).toContain("garage caraibes auto");
    expect(combinedContent).not.toMatch(/garanti|certifi|promotion|remise|gratuit|\d+\s?%/);

    const repeated = await services.generateMarketingCampaignProposals(
      owner.id,
      tenant.id,
    );
    expect(repeated).toEqual({ createdIds: [], candidateCount: 2 });

    const proposal = proposals[0];
    if (!proposal) throw new Error("Marketing proposal fixture is missing.");
    await services.submitMarketingProposalForApproval(owner.id, tenant.id, {
      proposalId: proposal.id,
    });
    const effectsBeforeDecision = await countOperationalEffects(db, tenant.id);
    const dashboard = await getDashboardData(db, owner.id, tenant.id, {
      now: new Date("2026-07-14T16:00:00.000Z"),
      timeZone: "America/Martinique",
    });
    expect(
      dashboard.commandCenter.pendingApprovals.some(
        (item) =>
          item.approvalType === "marketing" && item.actionHref === "/marketing",
      ),
    ).toBe(true);

    await services.decideMarketingProposal(owner.id, tenant.id, {
      proposalId: proposal.id,
      decision: "approved",
      reason: "Contenu vérifié et validé pour une planification manuelle.",
    });
    const decided = await services.getAutonomousMarketing(owner.id, tenant.id);
    expect(decided.find((item) => item.id === proposal.id)).toMatchObject({
      status: "approved",
      decisionReason: "Contenu vérifié et validé pour une planification manuelle.",
    });
    const approvals = await db.query<{ status: string }>(
      `select status from approvals
       where tenant_id = $1 and target_type = 'marketing_campaign_proposal'
         and target_id = $2`,
      [tenant.id, proposal.id],
    );
    expect(approvals.rows).toEqual([{ status: "approved" }]);
    const decisions = await db.query<{ decision: string; reason: string }>(
      `select decision, reason from marketing_campaign_decisions
       where tenant_id = $1 and proposal_id = $2`,
      [tenant.id, proposal.id],
    );
    expect(decisions.rows).toEqual([
      {
        decision: "approved",
        reason: "Contenu vérifié et validé pour une planification manuelle.",
      },
    ]);
    const audit = await db.query<{ safe_metadata: string }>(
      `select safe_metadata from audit_logs
       where tenant_id = $1 and action = 'autonomous_marketing.proposal_approved'
       order by created_at desc limit 1`,
      [tenant.id],
    );
    expect(safeJson(audit.rows[0]?.safe_metadata, {})).toMatchObject({
      executionTriggered: false,
    });
    expect(await countOperationalEffects(db, tenant.id)).toEqual(effectsBeforeDecision);

    await expect(
      services.getAutonomousMarketing(outsider.id, tenant.id),
    ).rejects.toThrow("Acces refuse");
    await expect(
      services.generateMarketingCampaignProposals(outsider.id, tenant.id),
    ).rejects.toThrow("Acces refuse");
  });

  it("creates an immutable draft version and retires its pending approval", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const owner = await services.registerUser({
      name: "Marketing Revision Owner",
      email: "marketing-revision@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: "Marketing Revision Garage",
      category: "Garage automobile",
    });
    await services.saveOnboarding(owner.id, tenant.id, defaultGarageOnboarding());
    const generation = await services.generateMarketingCampaignProposals(
      owner.id,
      tenant.id,
    );
    const proposalId = generation.createdIds[0];
    if (!proposalId) throw new Error("Marketing revision fixture is missing.");
    const current = (await services.getAutonomousMarketing(owner.id, tenant.id)).find(
      (item) => item.id === proposalId,
    );
    if (!current) throw new Error("Marketing revision record is missing.");
    await services.submitMarketingProposalForApproval(owner.id, tenant.id, {
      proposalId,
    });

    const revision = await services.reviseMarketingProposal(owner.id, tenant.id, {
      proposalId,
      title: `${current.title} — version relue`,
      subject: current.subject,
      objective: current.objective,
      audience: current.audience,
      content: `${current.content}\n\nTexte relu par l'équipe marketing.`,
      callToAction: current.callToAction,
      expectedOutcome: current.expectedOutcome,
      riskSummary: current.riskSummary,
      budgetCents: null,
      startsAt: null,
      endsAt: null,
    });
    expect(revision).toMatchObject({ version: 2 });
    const currentRows = await services.getAutonomousMarketing(owner.id, tenant.id);
    const revised = currentRows.find((item) => item.id === revision.proposalId);
    expect(revised).toMatchObject({
      status: "draft",
      version: 2,
    });
    expect(revised?.evidence.map((item) => item.ref)).toEqual(
      current.evidence.map((item) => item.ref),
    );
    const history = await db.query<{
      id: string;
      status: string;
      version: number;
      supersedes_id: string | null;
    }>(
      `select id, status, version, supersedes_id
       from marketing_campaign_proposals
       where tenant_id = $1 and campaign_key = $2
       order by version asc`,
      [tenant.id, current.campaignKey],
    );
    expect(history.rows).toEqual([
      { id: proposalId, status: "superseded", version: 1, supersedes_id: null },
      {
        id: revision.proposalId,
        status: "draft",
        version: 2,
        supersedes_id: proposalId,
      },
    ]);
    const approval = await db.query<{ status: string }>(
      `select status from approvals
       where tenant_id = $1 and target_type = 'marketing_campaign_proposal'
         and target_id = $2`,
      [tenant.id, proposalId],
    );
    expect(approval.rows).toEqual([{ status: "superseded" }]);
  });

  it("requires a verified Business Twin", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const owner = await services.registerUser({
      name: "Marketing Empty Owner",
      email: "marketing-empty@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: "Marketing Empty Tenant",
      category: "Services",
    });

    await expect(
      services.generateMarketingCampaignProposals(owner.id, tenant.id),
    ).rejects.toMatchObject({ code: "marketing_profile_required" });
    const proposals = await db.query<{ count: number | string }>(
      "select count(*)::int as count from marketing_campaign_proposals where tenant_id = $1",
      [tenant.id],
    );
    expect(Number(proposals.rows[0]?.count)).toBe(0);
  });
});

async function countOperationalEffects(
  db: Awaited<ReturnType<typeof createMemoryDb>>,
  tenantId: string,
) {
  const result = await db.query<{
    workflows: number | string;
    connectors: number | string;
    activities: number | string;
    domain_events: number | string;
    notifications: number | string;
  }>(
    `select
       (select count(*)::int from workflows where tenant_id = $1) as workflows,
       (select count(*)::int from connectors where tenant_id = $1) as connectors,
       (select count(*)::int from activities where tenant_id = $1) as activities,
       (select count(*)::int from domain_events where tenant_id = $1) as domain_events,
       (select count(*)::int from notifications where tenant_id = $1) as notifications`,
    [tenantId],
  );
  return {
    workflows: Number(result.rows[0]?.workflows),
    connectors: Number(result.rows[0]?.connectors),
    activities: Number(result.rows[0]?.activities),
    domainEvents: Number(result.rows[0]?.domain_events),
    notifications: Number(result.rows[0]?.notifications),
  };
}
