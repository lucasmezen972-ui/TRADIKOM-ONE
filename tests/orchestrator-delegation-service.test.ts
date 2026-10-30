import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import {
  configureConversationThreadAccess,
  ingestConversationMessage,
} from "../src/modules/conversation-hub";
import { strictMockCapabilityProvider } from "../src/modules/connector-execution";
import {
  createConversationActionPlan,
  decideConversationActionPlan,
  delegateConversationActionPlan,
  listConversationActionPlanDelegationTargets,
  reviseConversationActionPlan,
} from "../src/modules/orchestrator";
import type { Role } from "../src/lib/types";

type TestDb = Awaited<ReturnType<typeof createMemoryDb>>;

const opened: Array<{ close: () => Promise<void> }> = [];
const occurredAt = "2026-09-15T08:00:00.000Z";

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("délégation durable des plans Conversation", () => {
  it("délègue une décision une seule fois sans mission, contenu sensible ni effet externe", async () => {
    const fixture = await createPlanFixture("delegation-success");
    const manager = await addMember(
      fixture.db,
      fixture.tenantId,
      "manager",
      "Déléguée Martinique",
      "delegation-success-manager@example.test",
    );
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Aucun transport externe attendu."));
    const providerSpy = vi
      .spyOn(strictMockCapabilityProvider, "execute")
      .mockRejectedValue(new Error("Aucune capacité ne doit être exécutée."));
    const idempotencyKey = "delegation:success:once";

    const targets = await listConversationActionPlanDelegationTargets(
      fixture.db,
      fixture.ownerId,
      fixture.tenantId,
      fixture.plan.id,
    );
    expect(targets).toEqual([
      {
        userId: manager.id,
        name: "Déléguée Martinique",
        email: "delegation-success-manager@example.test",
        role: "manager",
      },
    ]);

    const delegated = await delegateConversationActionPlan(
      fixture.db,
      fixture.ownerId,
      fixture.tenantId,
      {
        planId: fixture.plan.id,
        delegatedToUserId: manager.id,
        expectedDelegationVersion: 0,
        idempotencyKey,
        confirmed: true,
      },
    );
    const replay = await delegateConversationActionPlan(
      fixture.db,
      fixture.ownerId,
      fixture.tenantId,
      {
        planId: fixture.plan.id,
        delegatedToUserId: manager.id,
        expectedDelegationVersion: 0,
        idempotencyKey,
        confirmed: true,
      },
    );

    expect(delegated).toMatchObject({
      id: fixture.plan.id,
      threadId: fixture.threadId,
      approvalStatus: "awaiting_approval",
      idempotentReplay: false,
      delegation: {
        version: 1,
        delegatedByUserId: fixture.ownerId,
        delegatedToUserId: manager.id,
        delegatedToName: "Déléguée Martinique",
        delegatedToRole: "manager",
      },
      steps: [{ status: "planned" }, { status: "planned" }],
    });
    expect(replay).toMatchObject({
      id: fixture.plan.id,
      idempotentReplay: true,
      delegation: { id: delegated.delegation?.id, version: 1 },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(providerSpy).not.toHaveBeenCalled();

    const evidence = await fixture.db.query<{
      delegations: number;
      delegationAudits: number;
      approvalStatus: string;
      receipts: number;
      runs: number;
      events: number;
      decisionMessages: number;
      rawKeyMatches: number;
      approvalId: string;
      safeMetadata: string;
      storedHash: string;
    }>(
      `select
         (select count(*)::int from conversation_action_plan_delegations
          where tenant_id = $1 and plan_id = $2) as delegations,
         (select count(*)::int from audit_logs where tenant_id = $1
          and action = 'conversation.plan_delegated' and target_id = $2)
          as "delegationAudits",
         (select status from approvals where tenant_id = $1
          and target_type = 'conversation_action_plan' and target_id = $2)
          as "approvalStatus",
         (select count(*)::int from conversation_action_plan_policy_receipts
          where tenant_id = $1 and plan_id = $2) as receipts,
         (select count(*)::int from workflow_runs where tenant_id = $1
          and workflow_key = $3) as runs,
         (select count(*)::int from domain_events where tenant_id = $1
          and correlation_id = $2) as events,
         (select count(*)::int from conversation_messages where tenant_id = $1
          and thread_id = $4 and kind in ('approval', 'result'))
          as "decisionMessages",
         (select count(*)::int from conversation_action_plan_delegations
          where tenant_id = $1 and idempotency_key_hash = $5)
          as "rawKeyMatches",
         (select approval_id from conversation_action_plan_delegations
          where tenant_id = $1 and plan_id = $2) as "approvalId",
         (select safe_metadata from audit_logs where tenant_id = $1
          and action = 'conversation.plan_delegated' and target_id = $2)
          as "safeMetadata",
         (select idempotency_key_hash from conversation_action_plan_delegations
          where tenant_id = $1 and plan_id = $2) as "storedHash"`,
      [
        fixture.tenantId,
        fixture.plan.id,
        `conversation_plan:${fixture.plan.id}`,
        fixture.threadId,
        idempotencyKey,
      ],
    );
    expect(evidence.rows[0]).toMatchObject({
      delegations: 1,
      delegationAudits: 1,
      approvalStatus: "pending",
      receipts: 0,
      runs: 0,
      events: 0,
      decisionMessages: 0,
      rawKeyMatches: 0,
      approvalId: fixture.plan.approvalId,
    });
    expect(evidence.rows[0]?.storedHash).toMatch(/^[a-f0-9]{64}$/);
    expect(evidence.rows[0]?.safeMetadata).not.toContain(manager.id);
    expect(evidence.rows[0]?.safeMetadata).not.toContain(manager.email);
    expect(evidence.rows[0]?.safeMetadata).not.toContain(idempotencyKey);

    await expect(
      decideConversationActionPlan(
        fixture.db,
        fixture.ownerId,
        fixture.tenantId,
        {
          planId: fixture.plan.id,
          decision: "approved",
          reason: "Tentative par l’ancien responsable.",
        },
      ),
    ).rejects.toMatchObject({ code: "orchestrator_permission_denied" });
    await expect(
      decideConversationActionPlan(
        fixture.db,
        manager.id,
        fixture.tenantId,
        {
          planId: fixture.plan.id,
          decision: "approved",
          reason: "Validation explicite par la délégataire.",
        },
      ),
    ).resolves.toMatchObject({ approvalStatus: "approved" });
  });

  it("ferme les collisions, les versions périmées, les rôles et les accès invalides", async () => {
    const fixture = await createPlanFixture("delegation-closed");
    const managerA = await addMember(
      fixture.db,
      fixture.tenantId,
      "manager",
      "Responsable A",
      "delegation-closed-a@example.test",
    );
    const managerB = await addMember(
      fixture.db,
      fixture.tenantId,
      "manager",
      "Responsable B",
      "delegation-closed-b@example.test",
    );
    const collaborator = await addMember(
      fixture.db,
      fixture.tenantId,
      "collaborator",
      "Collaboratrice",
      "delegation-closed-collab@example.test",
    );

    await configureConversationThreadAccess(fixture.db, fixture.ownerId, {
      tenantId: fixture.tenantId,
      threadId: fixture.threadId,
      visibilityScope: "team",
      grantedUserIds: [fixture.ownerId, managerA.id, collaborator.id],
      idempotencyKey: "delegation:closed:access",
    });
    const candidates = await listConversationActionPlanDelegationTargets(
      fixture.db,
      fixture.ownerId,
      fixture.tenantId,
      fixture.plan.id,
    );
    expect(candidates.map((target) => target.userId)).toEqual([managerA.id]);

    await expect(
      delegateConversationActionPlan(
        fixture.db,
        fixture.ownerId,
        fixture.tenantId,
        {
          planId: fixture.plan.id,
          delegatedToUserId: managerB.id,
          expectedDelegationVersion: 0,
          idempotencyKey: "delegation:closed:no-access",
          confirmed: true,
        },
      ),
    ).rejects.toMatchObject({ code: "orchestrator_permission_denied" });
    await expect(
      delegateConversationActionPlan(
        fixture.db,
        fixture.ownerId,
        fixture.tenantId,
        {
          planId: fixture.plan.id,
          delegatedToUserId: collaborator.id,
          expectedDelegationVersion: 0,
          idempotencyKey: "delegation:closed:bad-role",
          confirmed: true,
        },
      ),
    ).rejects.toMatchObject({ code: "orchestrator_permission_denied" });
    await expect(
      delegateConversationActionPlan(
        fixture.db,
        fixture.ownerId,
        fixture.tenantId,
        {
          planId: fixture.plan.id,
          delegatedToUserId: fixture.ownerId,
          expectedDelegationVersion: 0,
          idempotencyKey: "delegation:closed:self",
          confirmed: true,
        },
      ),
    ).rejects.toMatchObject({ code: "orchestrator_decision_conflict" });

    const delegated = await delegateConversationActionPlan(
      fixture.db,
      fixture.ownerId,
      fixture.tenantId,
      {
        planId: fixture.plan.id,
        delegatedToUserId: managerA.id,
        expectedDelegationVersion: 0,
        idempotencyKey: "delegation:closed:accepted",
        confirmed: true,
      },
    );
    expect(delegated.delegation?.version).toBe(1);
    await expect(
      delegateConversationActionPlan(
        fixture.db,
        managerA.id,
        fixture.tenantId,
        {
          planId: fixture.plan.id,
          delegatedToUserId: fixture.ownerId,
          expectedDelegationVersion: 0,
          idempotencyKey: "delegation:closed:stale",
          confirmed: true,
        },
      ),
    ).rejects.toMatchObject({ code: "orchestrator_decision_conflict" });
    await expect(
      delegateConversationActionPlan(
        fixture.db,
        fixture.ownerId,
        fixture.tenantId,
        {
          planId: fixture.plan.id,
          delegatedToUserId: fixture.ownerId,
          expectedDelegationVersion: 1,
          idempotencyKey: "delegation:closed:accepted",
          confirmed: true,
        },
      ),
    ).rejects.toMatchObject({ code: "orchestrator_decision_conflict" });

    const count = await fixture.db.query<{ count: number }>(
      `select count(*)::int as count
       from conversation_action_plan_delegations
       where tenant_id = $1 and plan_id = $2`,
      [fixture.tenantId, fixture.plan.id],
    );
    expect(count.rows).toEqual([{ count: 1 }]);
  });

  it("refuse le rejeu exact d'une délégation historique après une réaffectation", async () => {
    const fixture = await createPlanFixture("delegation-historical-replay");
    const managerA = await addMember(
      fixture.db,
      fixture.tenantId,
      "manager",
      "Responsable historique A",
      "delegation-historical-replay-a@example.test",
    );
    const managerB = await addMember(
      fixture.db,
      fixture.tenantId,
      "manager",
      "Responsable historique B",
      "delegation-historical-replay-b@example.test",
    );
    const firstKey = "delegation:historical:first";

    const first = await delegateConversationActionPlan(
      fixture.db,
      fixture.ownerId,
      fixture.tenantId,
      {
        planId: fixture.plan.id,
        delegatedToUserId: managerA.id,
        expectedDelegationVersion: 0,
        idempotencyKey: firstKey,
        confirmed: true,
      },
    );
    const second = await delegateConversationActionPlan(
      fixture.db,
      managerA.id,
      fixture.tenantId,
      {
        planId: fixture.plan.id,
        delegatedToUserId: managerB.id,
        expectedDelegationVersion: 1,
        idempotencyKey: "delegation:historical:second",
        confirmed: true,
      },
    );

    expect(first.delegation).toMatchObject({
      version: 1,
      delegatedToUserId: managerA.id,
    });
    expect(second.delegation).toMatchObject({
      version: 2,
      delegatedToUserId: managerB.id,
    });
    await expect(
      delegateConversationActionPlan(
        fixture.db,
        fixture.ownerId,
        fixture.tenantId,
        {
          planId: fixture.plan.id,
          delegatedToUserId: managerA.id,
          expectedDelegationVersion: 0,
          idempotencyKey: firstKey,
          confirmed: true,
        },
      ),
    ).rejects.toMatchObject({ code: "orchestrator_decision_conflict" });

    const persisted = await fixture.db.query<{
      count: number;
      audit_count: number;
      latest_version: number;
      latest_target: string;
    }>(
      `select
         (select count(*)::int from conversation_action_plan_delegations
          where tenant_id = $1 and plan_id = $2) as count,
         (select count(*)::int from audit_logs where tenant_id = $1
          and action = 'conversation.plan_delegated' and target_id = $2)
          as audit_count,
         (select version from conversation_action_plan_delegations
          where tenant_id = $1 and plan_id = $2
          order by version desc limit 1) as latest_version,
         (select delegated_to_user_id
          from conversation_action_plan_delegations
          where tenant_id = $1 and plan_id = $2
          order by version desc limit 1) as latest_target`,
      [fixture.tenantId, fixture.plan.id],
    );
    expect(persisted.rows).toEqual([
      {
        count: 2,
        audit_count: 2,
        latest_version: 2,
        latest_target: managerB.id,
      },
    ]);
  });

  it("autorise le délégataire à modifier puis remet la nouvelle version sans délégation héritée", async () => {
    const fixture = await createPlanFixture("delegation-revision");
    const manager = await addMember(
      fixture.db,
      fixture.tenantId,
      "manager",
      "Responsable modification",
      "delegation-revision-manager@example.test",
    );
    await delegateConversationActionPlan(
      fixture.db,
      fixture.ownerId,
      fixture.tenantId,
      {
        planId: fixture.plan.id,
        delegatedToUserId: manager.id,
        expectedDelegationVersion: 0,
        idempotencyKey: "delegation:revision:first",
        confirmed: true,
      },
    );

    await expect(
      reviseConversationActionPlan(
        fixture.db,
        fixture.ownerId,
        fixture.tenantId,
        {
          planId: fixture.plan.id,
          taskTitle: "Relancer vendredi matin",
        },
      ),
    ).rejects.toMatchObject({ code: "orchestrator_permission_denied" });
    const revised = await reviseConversationActionPlan(
      fixture.db,
      manager.id,
      fixture.tenantId,
      {
        planId: fixture.plan.id,
        taskTitle: "Relancer vendredi matin",
      },
    );
    expect(revised).toMatchObject({
      approvalStatus: "awaiting_approval",
      supersedesPlanId: fixture.plan.id,
      delegation: undefined,
    });
    await expect(
      decideConversationActionPlan(
        fixture.db,
        fixture.ownerId,
        fixture.tenantId,
        {
          planId: revised.id,
          decision: "rejected",
          reason: "Nouvelle version évaluée séparément.",
        },
      ),
    ).resolves.toMatchObject({ approvalStatus: "rejected" });
  });

  it("refuse toute cible et tout plan d'une autre organisation", async () => {
    const fixture = await createPlanFixture("delegation-tenant-a");
    const services = createServices(fixture.db);
    const otherOwner = await services.registerUser({
      name: "Propriétaire organisation B",
      email: "delegation-tenant-b-owner@example.test",
      password: "Password!1",
    });
    const otherTenant = await services.createTenant(otherOwner.id, {
      name: "Organisation délégation B",
      category: "Services",
    });

    await expect(
      delegateConversationActionPlan(
        fixture.db,
        fixture.ownerId,
        fixture.tenantId,
        {
          planId: fixture.plan.id,
          delegatedToUserId: otherOwner.id,
          expectedDelegationVersion: 0,
          idempotencyKey: "delegation:cross-tenant:target",
          confirmed: true,
        },
      ),
    ).rejects.toMatchObject({ code: "orchestrator_permission_denied" });
    await expect(
      delegateConversationActionPlan(
        fixture.db,
        otherOwner.id,
        otherTenant.id,
        {
          planId: fixture.plan.id,
          delegatedToUserId: otherOwner.id,
          expectedDelegationVersion: 0,
          idempotencyKey: "delegation:cross-tenant:plan",
          confirmed: true,
        },
      ),
    ).rejects.toMatchObject({ code: "orchestrator_plan_not_found" });
    await expect(
      listConversationActionPlanDelegationTargets(
        fixture.db,
        otherOwner.id,
        otherTenant.id,
        fixture.plan.id,
      ),
    ).rejects.toMatchObject({ code: "orchestrator_plan_not_found" });

    const count = await fixture.db.query<{ count: number }>(
      `select count(*)::int as count
       from conversation_action_plan_delegations
       where tenant_id in ($1, $2)`,
      [fixture.tenantId, otherTenant.id],
    );
    expect(count.rows).toEqual([{ count: 0 }]);
  });

  it("borne à 32 réaffectations et ferme les propositions suivantes", async () => {
    const fixture = await createPlanFixture("delegation-limit");
    const manager = await addMember(
      fixture.db,
      fixture.tenantId,
      "manager",
      "Responsable plafond",
      "delegation-limit-manager@example.test",
    );

    let actorId = fixture.ownerId;
    let targetId = manager.id;
    for (let expectedVersion = 0; expectedVersion < 32; expectedVersion += 1) {
      const result = await delegateConversationActionPlan(
        fixture.db,
        actorId,
        fixture.tenantId,
        {
          planId: fixture.plan.id,
          delegatedToUserId: targetId,
          expectedDelegationVersion: expectedVersion,
          idempotencyKey: `delegation:limit:${expectedVersion + 1}`,
          confirmed: true,
        },
      );
      expect(result.delegation?.version).toBe(expectedVersion + 1);
      [actorId, targetId] = [targetId, actorId];
    }

    await expect(
      listConversationActionPlanDelegationTargets(
        fixture.db,
        actorId,
        fixture.tenantId,
        fixture.plan.id,
      ),
    ).resolves.toEqual([]);
    await expect(
      delegateConversationActionPlan(
        fixture.db,
        actorId,
        fixture.tenantId,
        {
          planId: fixture.plan.id,
          delegatedToUserId: targetId,
          expectedDelegationVersion: 32,
          idempotencyKey: "delegation:limit:33",
          confirmed: true,
        },
      ),
    ).rejects.toMatchObject({ code: "orchestrator_decision_conflict" });

    const persisted = await fixture.db.query<{ count: number; maximum: number }>(
      `select count(*)::int as count, max(version)::int as maximum
       from conversation_action_plan_delegations
       where tenant_id = $1 and plan_id = $2`,
      [fixture.tenantId, fixture.plan.id],
    );
    expect(persisted.rows).toEqual([{ count: 32, maximum: 32 }]);
  });
});

async function createPlanFixture(slug: string) {
  const db = await createMemoryDb();
  opened.push(db);
  const services = createServices(db);
  const owner = await services.registerUser({
    name: "Propriétaire du plan",
    email: `${slug}-owner@example.test`,
    password: "Password!1",
  });
  const tenant = await services.createTenant(owner.id, {
    name: `Organisation ${slug}`,
    category: "Services",
  });
  const source = await ingestConversationMessage(db, owner.id, {
    tenantId: tenant.id,
    channelIdentity: {
      id: `identity_${slug}`,
      tenantId: tenant.id,
      participantId: `participant_${slug}`,
      channelKind: "web",
      adapterKey: "web-chat",
      externalSubjectId: `member_${slug}`,
      displayName: "Membre de démonstration",
      role: "member",
      state: "active",
      createdAt: occurredAt,
      updatedAt: occurredAt,
    },
    externalMessageId: `external_${slug}`,
    idempotencyKey: `ingress:web:${slug}`,
    correlationId: `correlation_${slug}`,
    routeTrace: [],
    text: "Préparer une relance commerciale pour ce contact.",
    attachments: [],
    occurredAt,
  });
  const plan = await createConversationActionPlan(db, owner.id, {
    tenantId: tenant.id,
    threadId: source.threadId,
    sourceMessageId: source.messageId,
  });
  return {
    db,
    ownerId: owner.id,
    tenantId: tenant.id,
    threadId: source.threadId,
    plan,
  };
}

async function addMember(
  db: TestDb,
  tenantId: string,
  role: Role,
  name: string,
  email: string,
) {
  const user = await createServices(db).registerUser({
    name,
    email,
    password: "Password!1",
  });
  await db.query(
    `insert into memberships (tenant_id, user_id, role, created_at)
     values ($1, $2, $3, $4)`,
    [tenantId, user.id, role, occurredAt],
  );
  return user;
}
