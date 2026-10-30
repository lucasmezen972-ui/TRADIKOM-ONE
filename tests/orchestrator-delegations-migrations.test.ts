import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb, getMigrationIds } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import { ingestConversationMessage } from "../src/modules/conversation-hub";
import {
  createConversationActionPlan,
  decideConversationActionPlan,
  delegateConversationActionPlan,
} from "../src/modules/orchestrator";

const opened: Array<{ close: () => Promise<void> }> = [];
const occurredAt = "2026-09-14T09:00:00.000Z";

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("migrations des délégations de plans Conversation", () => {
  it("garde les migrations runtime et leurs miroirs SQL strictement identiques", () => {
    const runtime = readFileSync(
      new URL("../src/lib/db.ts", import.meta.url),
      "utf8",
    );
    const baseMirror = readFileSync(
      new URL(
        "../src/db/migrations/0116_os5_conversation_action_plan_delegations.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const rlsMirror = readFileSync(
      new URL(
        "../src/db/migrations/0117_os5_conversation_action_plan_delegations_rls.sql",
        import.meta.url,
      ),
      "utf8",
    );

    expect(
      extractSqlTemplate(
        runtime,
        "os5ConversationActionPlanDelegationsMigrationSql",
      ).trim(),
    ).toBe(baseMirror.trim());
    expect(
      extractSqlTemplate(
        runtime,
        "os5ConversationActionPlanDelegationsRlsMigrationSql",
      ).trim(),
    ).toBe(rlsMirror.trim());
    expect(getMigrationIds().at(-1)).toBe(
      "122_os5_conversation_action_plan_delegations",
    );
    expect(getMigrationIds(true).at(-1)).toBe(
      "123_os5_conversation_action_plan_delegations_rls",
    );
    expect(baseMirror).toContain("approval_id text not null");
    expect(baseMirror).toContain(
      "references approvals(tenant_id, id, target_type, target_id)",
    );
    expect(baseMirror).toContain(
      "conversation_action_plan_delegated_decider_invalid",
    );
    expect(baseMirror).toContain("if actor_role is null");
    expect(baseMirror).toContain("or target_role is null");
    expect(baseMirror).not.toMatch(/security\s+definer/i);
    expect(rlsMirror).toContain("app_actor_can_access_conversation_plan");
    expect(rlsMirror.match(/with check \(app_is_system\(\)\)/g)).toHaveLength(2);
  });

  it("lie la délégation au plan et à l'approval exacts puis protège son historique", async () => {
    const fixture = await seedFixture();
    const delegated = await delegateConversationActionPlan(
      fixture.db,
      fixture.ownerId,
      fixture.tenantId,
      {
        planId: fixture.planId,
        delegatedToUserId: fixture.managerId,
        expectedDelegationVersion: 0,
        idempotencyKey: "delegation:migration:exact",
        confirmed: true,
      },
    );
    const delegationId = delegated.delegation!.id;

    const columns = await fixture.db.query<{ column_name: string }>(
      `select column_name from information_schema.columns
       where table_schema = 'public'
         and table_name = 'conversation_action_plan_delegations'
       order by ordinal_position`,
    );
    expect(columns.rows.map((row) => row.column_name)).toEqual(
      expect.arrayContaining([
        "approval_id",
        "idempotency_key_hash",
        "request_fingerprint",
      ]),
    );
    expect(columns.rows.map((row) => row.column_name)).not.toContain(
      "idempotency_key",
    );

    const binding = await fixture.db.query<{
      plan_id: string;
      approval_id: string;
      target_id: string;
      status: string;
    }>(
      `select delegation.plan_id, delegation.approval_id,
              approval.target_id, approval.status
       from conversation_action_plan_delegations delegation
       join approvals approval
         on approval.tenant_id = delegation.tenant_id
        and approval.id = delegation.approval_id
        and approval.target_type = delegation.approval_target_type
        and approval.target_id = delegation.plan_id
       where delegation.tenant_id = $1 and delegation.id = $2`,
      [fixture.tenantId, delegationId],
    );
    expect(binding.rows).toEqual([
      {
        plan_id: fixture.planId,
        approval_id: fixture.approvalId,
        target_id: fixture.planId,
        status: "pending",
      },
    ]);

    await expect(
      fixture.db.query(
        `update conversation_action_plan_delegations
         set delegated_to_role = 'owner'
         where tenant_id = $1 and id = $2`,
        [fixture.tenantId, delegationId],
      ),
    ).rejects.toThrow(/conversation_action_plan_delegation_immutable/i);
    await expect(
      fixture.db.query(
        `delete from conversation_action_plan_delegations
         where tenant_id = $1 and id = $2`,
        [fixture.tenantId, delegationId],
      ),
    ).rejects.toThrow(/conversation_action_plan_delegation_immutable/i);
    await expect(
      fixture.db.query(
        `insert into conversation_action_plan_delegations (
           id, tenant_id, plan_id, plan_fingerprint, approval_id,
           approval_target_type, version, expected_previous_version,
           delegated_by_user_id, delegated_to_user_id, delegated_to_role,
           idempotency_key_hash, request_fingerprint, created_at
         ) select
           'delegation_wrong_approval', tenant_id, plan_id, plan_fingerprint,
           'approval_missing', approval_target_type, 2, 1,
           delegated_to_user_id, delegated_by_user_id, 'owner',
           $3, $4, created_at
         from conversation_action_plan_delegations
         where tenant_id = $1 and id = $2`,
        [fixture.tenantId, delegationId, "a".repeat(64), "b".repeat(64)],
      ),
    ).rejects.toThrow(
      /conversation_action_plan_delegation_plan_invalid|foreign key|violates/i,
    );
    await expect(
      fixture.db.query(
        `insert into conversation_action_plan_delegations (
           id, tenant_id, plan_id, plan_fingerprint, approval_id,
           approval_target_type, version, expected_previous_version,
           delegated_by_user_id, delegated_to_user_id, delegated_to_role,
           idempotency_key_hash, request_fingerprint, created_at
         ) select
           'delegation_wrong_version', tenant_id, plan_id, plan_fingerprint,
           approval_id, approval_target_type, 2, 0,
           delegated_to_user_id, delegated_by_user_id, 'owner',
           $3, $4, created_at
         from conversation_action_plan_delegations
         where tenant_id = $1 and id = $2`,
        [fixture.tenantId, delegationId, "c".repeat(64), "d".repeat(64)],
      ),
    ).rejects.toThrow(/check constraint|violates|transition_invalid/i);
  });

  it("refuse au niveau SQL les acteurs et cibles absents, externes ou supprimés", async () => {
    const fixture = await seedFixture();
    const services = createServices(fixture.db);
    const outsider = await services.registerUser({
      name: "Personne externe",
      email: `delegation-migration-outsider-${opened.length}@example.test`,
      password: "Password!1",
    });
    const deletedActor = await services.registerUser({
      name: "Responsable supprimé",
      email: `delegation-migration-deleted-${opened.length}@example.test`,
      password: "Password!1",
    });
    await fixture.db.query(
      `insert into memberships (tenant_id, user_id, role, created_at)
       values ($1, $2, 'manager', $3)`,
      [fixture.tenantId, deletedActor.id, occurredAt],
    );
    await fixture.db.query(
      `update users set deleted_at = $2 where id = $1`,
      [deletedActor.id, occurredAt],
    );
    const delegated = await delegateConversationActionPlan(
      fixture.db,
      fixture.ownerId,
      fixture.tenantId,
      {
        planId: fixture.planId,
        delegatedToUserId: fixture.managerId,
        expectedDelegationVersion: 0,
        idempotencyKey: "delegation:migration:role-guard",
        confirmed: true,
      },
    );

    await expect(
      insertDelegationDirectly(fixture, delegated.delegation!.id, {
        id: "delegation_outsider_actor",
        actorId: outsider.id,
        targetId: fixture.ownerId,
        targetRole: "owner",
        hashSeed: "e",
      }),
    ).rejects.toThrow(/conversation_action_plan_delegation_role_invalid/i);
    await expect(
      insertDelegationDirectly(fixture, delegated.delegation!.id, {
        id: "delegation_outsider_target",
        actorId: fixture.managerId,
        targetId: outsider.id,
        targetRole: "manager",
        hashSeed: "f",
      }),
    ).rejects.toThrow(/conversation_action_plan_delegation_role_invalid/i);
    await expect(
      insertDelegationDirectly(fixture, delegated.delegation!.id, {
        id: "delegation_deleted_actor",
        actorId: deletedActor.id,
        targetId: fixture.ownerId,
        targetRole: "owner",
        hashSeed: "1",
      }),
    ).rejects.toThrow(/conversation_action_plan_delegation_role_invalid/i);

    const persisted = await fixture.db.query<{ count: number }>(
      `select count(*)::int as count
       from conversation_action_plan_delegations
       where tenant_id = $1 and plan_id = $2`,
      [fixture.tenantId, fixture.planId],
    );
    expect(persisted.rows).toEqual([{ count: 1 }]);
  });

  it("refuse au niveau SQL une décision par une autre personne que le délégataire", async () => {
    const fixture = await seedFixture();
    await delegateConversationActionPlan(
      fixture.db,
      fixture.ownerId,
      fixture.tenantId,
      {
        planId: fixture.planId,
        delegatedToUserId: fixture.managerId,
        expectedDelegationVersion: 0,
        idempotencyKey: "delegation:migration:decider",
        confirmed: true,
      },
    );

    await expect(
      fixture.db.query(
        `update conversation_action_plans
         set approval_status = 'rejected', decided_by = $3,
             decided_at = $4, decision_reason = 'Décision SQL interdite',
             updated_at = $4
         where tenant_id = $1 and id = $2`,
        [fixture.tenantId, fixture.planId, fixture.ownerId, occurredAt],
      ),
    ).rejects.toThrow(/conversation_action_plan_delegated_decider_invalid/i);

    await expect(
      decideConversationActionPlan(
        fixture.db,
        fixture.managerId,
        fixture.tenantId,
        {
          planId: fixture.planId,
          decision: "rejected",
          reason: "Décision explicite du délégataire.",
        },
      ),
    ).resolves.toMatchObject({ approvalStatus: "rejected" });
  });
});

async function seedFixture() {
  const db = await createMemoryDb();
  opened.push(db);
  const services = createServices(db);
  const owner = await services.registerUser({
    name: "Propriétaire migration",
    email: `delegation-migration-owner-${opened.length}@example.test`,
    password: "Password!1",
  });
  const manager = await services.registerUser({
    name: "Responsable migration",
    email: `delegation-migration-manager-${opened.length}@example.test`,
    password: "Password!1",
  });
  const tenant = await services.createTenant(owner.id, {
    name: `Organisation délégation migration ${opened.length}`,
    category: "Services",
  });
  await db.query(
    `insert into memberships (tenant_id, user_id, role, created_at)
     values ($1, $2, 'manager', $3)`,
    [tenant.id, manager.id, occurredAt],
  );
  const source = await ingestConversationMessage(db, owner.id, {
    tenantId: tenant.id,
    channelIdentity: {
      id: `identity_delegation_migration_${opened.length}`,
      tenantId: tenant.id,
      participantId: `participant_delegation_migration_${opened.length}`,
      channelKind: "web",
      adapterKey: "web-chat",
      externalSubjectId: `member_delegation_migration_${opened.length}`,
      displayName: "Membre de démonstration",
      role: "member",
      state: "active",
      createdAt: occurredAt,
      updatedAt: occurredAt,
    },
    externalMessageId: `external_delegation_migration_${opened.length}`,
    idempotencyKey: `ingress:delegation:migration:${opened.length}`,
    correlationId: `correlation_delegation_migration_${opened.length}`,
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
    managerId: manager.id,
    tenantId: tenant.id,
    planId: plan.id,
    approvalId: plan.approvalId!,
  };
}

async function insertDelegationDirectly(
  fixture: Awaited<ReturnType<typeof seedFixture>>,
  sourceDelegationId: string,
  input: {
    id: string;
    actorId: string;
    targetId: string;
    targetRole: "owner" | "administrator" | "manager";
    hashSeed: string;
  },
) {
  return fixture.db.query(
    `insert into conversation_action_plan_delegations (
       id, tenant_id, plan_id, plan_fingerprint, approval_id,
       approval_target_type, version, expected_previous_version,
       delegated_by_user_id, delegated_to_user_id, delegated_to_role,
       idempotency_key_hash, request_fingerprint, created_at
     ) select
       $3, tenant_id, plan_id, plan_fingerprint, approval_id,
       approval_target_type, 2, 1, $4, $5, $6, $7, $8, created_at
     from conversation_action_plan_delegations
     where tenant_id = $1 and id = $2`,
    [
      fixture.tenantId,
      sourceDelegationId,
      input.id,
      input.actorId,
      input.targetId,
      input.targetRole,
      input.hashSeed.repeat(64),
      input.hashSeed.toUpperCase().repeat(64).toLowerCase(),
    ],
  );
}

function extractSqlTemplate(source: string, constant: string) {
  const prefix = `const ${constant} = \``;
  const start = source.indexOf(prefix);
  if (start < 0) throw new Error(`Constante SQL introuvable : ${constant}`);
  const contentStart = start + prefix.length;
  const end = source.indexOf("`;", contentStart);
  if (end < 0) throw new Error(`Fin SQL introuvable : ${constant}`);
  return source.slice(contentStart, end);
}
