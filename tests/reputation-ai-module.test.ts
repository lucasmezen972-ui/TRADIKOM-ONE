import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb, type DbClient } from "../src/lib/db";
import { safeJson } from "../src/lib/security";
import { createServices } from "../src/lib/services";
import { generateReputationProposals } from "../src/modules/reputation-ai";

const opened: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("Reputation AI module", () => {
  it("uses imported evidence, approval decisions and never triggers publication", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const owner = await services.registerUser({
      name: "Reputation Owner",
      email: "reputation-owner@example.com",
      password: "Password!1",
    });
    const outsider = await services.registerUser({
      name: "Reputation Outsider",
      email: "reputation-outsider@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: "Reputation Garage",
      category: "Garage automobile",
    });
    const negativeText = "Très déçu : retard, attente et problème non résolu.";
    const positiveText = "Excellent accueil, service rapide et professionnel.";
    const occurredAt = "2026-07-14T10:00:00.000Z";
    await services.createReputationReview(owner.id, tenant.id, {
      source: "google",
      reviewerAlias: "Client A",
      rating: 1,
      reviewText: negativeText,
      occurredAt,
    });
    await services.createReputationReview(owner.id, tenant.id, {
      source: "direct_feedback",
      rating: 5,
      reviewText: positiveText,
      occurredAt: "2026-07-13T09:00:00.000Z",
    });
    await expect(
      services.createReputationReview(owner.id, tenant.id, {
        source: "google",
        reviewerAlias: "Client A",
        rating: 1,
        reviewText: negativeText,
        occurredAt,
      }),
    ).rejects.toMatchObject({ code: "reputation_review_duplicate" });

    const operationalBefore = await countOperationalEffects(db, tenant.id);
    const generated = await services.generateReputationProposals(
      owner.id,
      tenant.id,
    );
    expect(generated).toMatchObject({ reviewCount: 2, supersededCount: 0 });
    expect(generated.createdIds).toHaveLength(2);
    const repeated = await services.generateReputationProposals(owner.id, tenant.id);
    expect(repeated).toMatchObject({ createdIds: [], reviewCount: 2 });

    const workspace = await services.getReputationWorkspace(owner.id, tenant.id);
    expect(workspace.reviews).toHaveLength(2);
    expect(workspace.proposals).toHaveLength(2);
    const negative = workspace.proposals.find(
      (proposal) => proposal.sentiment === "negative",
    );
    const positive = workspace.proposals.find(
      (proposal) => proposal.sentiment === "positive",
    );
    expect(negative).toMatchObject({
      riskLevel: "high",
      authenticityStatus: "not_assessed",
      status: "proposed",
      version: 1,
    });
    expect(negative?.rationale).toContain("ne vérifie ni l'auteur ni l'authenticité");
    expect(negative?.evidence).toHaveLength(3);
    expect(positive).toMatchObject({
      riskLevel: "low",
      authenticityStatus: "not_assessed",
      status: "proposed",
    });
    if (!negative || !positive) {
      throw new Error("Reputation AI fixtures are incomplete.");
    }

    await services.submitReputationProposalForApproval(owner.id, tenant.id, {
      proposalId: negative.id,
    });
    const dashboard = await services.getDashboard(owner.id, tenant.id);
    expect(dashboard.commandCenter.pendingApprovals).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          title: "Validation d'une réponse à un avis",
          actionHref: "/reputation",
          approvalType: "reputation",
        }),
      ]),
    );
    await services.decideReputationProposal(owner.id, tenant.id, {
      proposalId: negative.id,
      decision: "approved",
      reason: "Réponse adaptée, sans publication automatique.",
    });
    await services.submitReputationProposalForApproval(owner.id, tenant.id, {
      proposalId: positive.id,
    });
    await services.decideReputationProposal(owner.id, tenant.id, {
      proposalId: positive.id,
      decision: "rejected",
      reason: "Le ton doit être repris manuellement.",
    });
    const decided = await services.getReputationWorkspace(owner.id, tenant.id);
    expect(decided.proposals.map((proposal) => proposal.status).sort()).toEqual([
      "approved",
      "rejected",
    ]);
    expect(await countOperationalEffects(db, tenant.id)).toEqual(operationalBefore);

    const audit = await db.query<{ safe_metadata: string }>(
      `select safe_metadata from audit_logs
       where tenant_id = $1 and action like 'reputation.%'`,
      [tenant.id],
    );
    expect(audit.rows).not.toHaveLength(0);
    for (const row of audit.rows) {
      const serialized = JSON.stringify(safeJson(row.safe_metadata, {}));
      expect(serialized).not.toContain(negativeText);
      expect(serialized).not.toContain(positiveText);
    }
    expect(
      audit.rows.some((row) =>
        JSON.stringify(safeJson(row.safe_metadata, {})).includes(
          '"publicationTriggered":false',
        ),
      ),
    ).toBe(true);

    await expect(
      services.getReputationWorkspace(outsider.id, tenant.id),
    ).rejects.toThrow("Acces refuse");
    await expect(
      services.createReputationReview(outsider.id, tenant.id, {
        source: "manual_import",
        reviewText: "Avis inter-tenant interdit.",
        occurredAt,
      }),
    ).rejects.toThrow("Acces refuse");
  });

  it("rolls back a proposal when evidence persistence fails", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const owner = await services.registerUser({
      name: "Reputation Rollback Owner",
      email: "reputation-rollback@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: "Reputation Rollback Garage",
      category: "Garage automobile",
    });
    await services.createReputationReview(owner.id, tenant.id, {
      source: "manual_import",
      rating: 2,
      reviewText: "Attente trop longue lors du rendez-vous.",
      occurredAt: "2026-07-14T12:00:00.000Z",
    });
    const failingDb: DbClient = {
      query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => {
        if (sql.includes("insert into reputation_proposal_evidence")) {
          throw new Error("injected reputation evidence failure");
        }
        return db.query<T>(sql, params);
      },
    };

    await expect(
      generateReputationProposals(failingDb, owner.id, tenant.id),
    ).rejects.toThrow("injected reputation evidence failure");
    expect(await countRows(db, "reputation_response_proposals", tenant.id)).toBe(0);
    expect(await countRows(db, "reputation_proposal_evidence", tenant.id)).toBe(0);
  });
});

async function countOperationalEffects(
  db: Awaited<ReturnType<typeof createMemoryDb>>,
  tenantId: string,
) {
  const result = await db.query<{
    activities: number | string;
    domain_events: number | string;
    notifications: number | string;
    website_versions: number | string;
  }>(
    `select
       (select count(*) from activities where tenant_id = $1) as activities,
       (select count(*) from domain_events where tenant_id = $1) as domain_events,
       (select count(*) from notifications where tenant_id = $1) as notifications,
       (select count(*) from website_versions where tenant_id = $1) as website_versions`,
    [tenantId],
  );
  return {
    activities: Number(result.rows[0]?.activities ?? 0),
    domainEvents: Number(result.rows[0]?.domain_events ?? 0),
    notifications: Number(result.rows[0]?.notifications ?? 0),
    websiteVersions: Number(result.rows[0]?.website_versions ?? 0),
  };
}

async function countRows(
  db: Awaited<ReturnType<typeof createMemoryDb>>,
  table: string,
  tenantId: string,
) {
  const result = await db.query<{ count: number | string }>(
    `select count(*) as count from ${table} where tenant_id = $1`,
    [tenantId],
  );
  return Number(result.rows[0]?.count ?? 0);
}
