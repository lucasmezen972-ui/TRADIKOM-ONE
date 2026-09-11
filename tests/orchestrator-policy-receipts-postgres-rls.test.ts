import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import {
  pgClientAsSqlClient,
  pgPoolAsSqlClient,
  type SqlClient,
} from "../src/db/client";
import { migrate } from "../src/lib/db";
import { insertConversationActionPlanPolicyReceipt } from "../src/modules/orchestrator/repository";
import {
  createConversationActionPlan,
  decideConversationActionPlan,
} from "../src/modules/orchestrator/service";

const databaseUrl = process.env.DATABASE_URL;
const describeIfPostgres = databaseUrl ? describe : describe.skip;
const ownerPools: Pool[] = [];
const restrictedPools: Pool[] = [];
const restrictedRoles: Array<{ ownerPool: Pool; roleName: string }> = [];
const timestamp = "2026-09-11T04:15:00.000Z";

afterEach(async () => {
  await Promise.all(restrictedPools.splice(0).map((pool) => pool.end()));
  for (const role of restrictedRoles.splice(0)) {
    await dropRestrictedRole(role.ownerPool, role.roleName);
  }
  await Promise.all(ownerPools.splice(0).map((pool) => pool.end()));
});

describeIfPostgres("RLS PostgreSQL des reçus de policy Conversation", () => {
  it("borne la lecture au tenant et réserve l'émission au runtime système", async () => {
    if (!databaseUrl) throw new Error("DATABASE_URL est requis.");
    const ownerPool = new Pool({ connectionString: databaseUrl });
    ownerPools.push(ownerPool);
    const ownerDb = pgPoolAsSqlClient(ownerPool);
    await migrate(ownerDb, { enableRls: true });

    const suffix = randomUUID().replaceAll("-", "");
    const tenantA = `tenant_policy_rls_a_${suffix}`;
    const tenantB = `tenant_policy_rls_b_${suffix}`;
    const ownerA = `user_policy_rls_owner_a_${suffix}`;
    const collaboratorA = `user_policy_rls_collaborator_a_${suffix}`;
    const managerA = `user_policy_rls_manager_a_${suffix}`;
    const ownerB = `user_policy_rls_owner_b_${suffix}`;
    const contextA = await seedConversationContext(ownerPool, {
      tenantId: tenantA,
      tenantName: "Organisation Policy A",
      userIds: [ownerA, collaboratorA, managerA],
      roles: ["owner", "collaborator", "manager"],
      suffix: `a_${suffix}`,
    });
    const contextB = await seedConversationContext(ownerPool, {
      tenantId: tenantB,
      tenantName: "Organisation Policy B",
      userIds: [ownerB],
      roles: ["owner"],
      suffix: `b_${suffix}`,
    });

    const manualA = await seedApprovedPlan(ownerPool, {
      tenantId: tenantA,
      userId: ownerA,
      threadId: contextA.threadId,
      messageId: contextA.messageId,
      planId: `plan_policy_rls_manual_a_${suffix}`,
      approvalId: `approval_policy_rls_manual_a_${suffix}`,
      planFingerprint: "a".repeat(64),
      approvalMode: "single",
    });
    const automaticA = await seedApprovedPlan(ownerPool, {
      tenantId: tenantA,
      userId: collaboratorA,
      threadId: contextA.threadId,
      messageId: contextA.messageId,
      planId: `plan_policy_rls_auto_a_${suffix}`,
      approvalId: null,
      planFingerprint: "c".repeat(64),
      approvalMode: "none",
    });
    const collaboratorManualA = await seedApprovedPlan(ownerPool, {
      tenantId: tenantA,
      userId: collaboratorA,
      threadId: contextA.threadId,
      messageId: contextA.messageId,
      planId: `plan_policy_rls_collaborator_manual_a_${suffix}`,
      approvalId: `approval_policy_rls_collaborator_manual_a_${suffix}`,
      planFingerprint: "d".repeat(64),
      approvalMode: "single",
    });
    const managerManualA = await seedApprovedPlan(ownerPool, {
      tenantId: tenantA,
      userId: managerA,
      threadId: contextA.threadId,
      messageId: contextA.messageId,
      planId: `plan_policy_rls_manager_manual_a_${suffix}`,
      approvalId: `approval_policy_rls_manager_manual_a_${suffix}`,
      planFingerprint: "e".repeat(64),
      approvalMode: "single",
    });
    const manualB = await seedApprovedPlan(ownerPool, {
      tenantId: tenantB,
      userId: ownerB,
      threadId: contextB.threadId,
      messageId: contextB.messageId,
      planId: `plan_policy_rls_manual_b_${suffix}`,
      approvalId: `approval_policy_rls_manual_b_${suffix}`,
      planFingerprint: "f".repeat(64),
      approvalMode: "single",
    });
    await insertConversationActionPlanPolicyReceipt(ownerDb, receiptInput({
      ...manualB,
      tenantId: tenantB,
      approvedByUserId: ownerB,
      role: "owner",
      receiptFingerprint: "0".repeat(64),
    }));

    const restricted = await createRestrictedRole(ownerPool);
    restrictedRoles.push({ ownerPool, roleName: restricted.roleName });
    const restrictedPool = new Pool({ connectionString: restricted.databaseUrl });
    restrictedPools.push(restrictedPool);

    const trustedRuntime = await createTrustedRuntimeRole(ownerPool);
    restrictedRoles.push({ ownerPool, roleName: trustedRuntime.roleName });
    const trustedRuntimePool = new Pool({
      connectionString: trustedRuntime.databaseUrl,
    });
    restrictedPools.push(trustedRuntimePool);
    const trustedRuntimeDb = pgPoolAsSqlClient(trustedRuntimePool);
    const trustedRuntimeFlags = await trustedRuntimePool.query<{
      rolsuper: boolean;
      rolbypassrls: boolean;
      rolinherit: boolean;
      owner_member: boolean;
    }>(
      `select role.rolsuper, role.rolbypassrls, role.rolinherit,
         pg_has_role(
           current_user,
           (select relowner from pg_class where oid = 'public.tenants'::regclass),
           'MEMBER'
         ) as owner_member
       from pg_roles role
       where role.rolname = current_user`,
    );
    expect(trustedRuntimeFlags.rows).toEqual([
      {
        rolsuper: false,
        rolbypassrls: false,
        rolinherit: false,
        owner_member: true,
      },
    ]);

    const { servicePlan, serviceDecision } =
      await withForcedConversationPolicyRls(ownerDb, async () => {
        const plan = await createConversationActionPlan(
          trustedRuntimeDb,
          ownerA,
          {
            tenantId: tenantA,
            threadId: contextA.threadId,
            sourceMessageId: contextA.messageId,
          },
        );
        const decision = await decideConversationActionPlan(
          trustedRuntimeDb,
          ownerA,
          tenantA,
          {
            planId: plan.id,
            decision: "approved",
            reason: "Validation serveur RLS",
          },
        );
        return { servicePlan: plan, serviceDecision: decision };
      });
    expect(serviceDecision.policyReceipt).toMatchObject({ schemaVersion: 1 });

    await expect(
      withTenantContext(restrictedPool, tenantA, ownerA, (client) =>
        insertConversationActionPlanPolicyReceipt(
          pgClientAsSqlClient(client),
          receiptInput({
            ...manualA,
            tenantId: tenantA,
            approvedByUserId: ownerA,
            role: "owner",
            receiptFingerprint: "1".repeat(64),
          }),
        ),
      ),
    ).rejects.toThrow(/row-level security|violates/i);
    const insertedManual = await withTenantSystemContext(
      ownerPool,
      tenantA,
      ownerA,
      (client) =>
        insertConversationActionPlanPolicyReceipt(
          pgClientAsSqlClient(client),
          receiptInput({
            ...manualA,
            tenantId: tenantA,
            approvedByUserId: ownerA,
            role: "owner",
            receiptFingerprint: "1".repeat(64),
          }),
        ),
    );
    expect(insertedManual?.plan_id).toBe(manualA.planId);

    await expect(
      withTenantContext(restrictedPool, tenantA, collaboratorA, (client) =>
        insertConversationActionPlanPolicyReceipt(
          pgClientAsSqlClient(client),
          receiptInput({
            ...automaticA,
            tenantId: tenantA,
            approvedByUserId: collaboratorA,
            role: "collaborator",
            receiptFingerprint: "2".repeat(64),
          }),
        ),
      ),
    ).rejects.toThrow(/row-level security|violates/i);
    const insertedAutomatic = await withTenantSystemContext(
      ownerPool,
      tenantA,
      collaboratorA,
      (client) =>
        insertConversationActionPlanPolicyReceipt(
          pgClientAsSqlClient(client),
          receiptInput({
            ...automaticA,
            tenantId: tenantA,
            approvedByUserId: collaboratorA,
            role: "collaborator",
            receiptFingerprint: "2".repeat(64),
          }),
        ),
    );
    expect(insertedAutomatic?.plan_id).toBe(automaticA.planId);

    await expect(
      withTenantContext(
        restrictedPool,
        tenantA,
        collaboratorA,
        (client) =>
          insertConversationActionPlanPolicyReceipt(
            pgClientAsSqlClient(client),
            receiptInput({
              ...collaboratorManualA,
              tenantId: tenantA,
              approvedByUserId: collaboratorA,
              role: "collaborator",
              receiptFingerprint: "3".repeat(64),
            }),
          ),
      ),
    ).rejects.toThrow(/binding_invalid|row-level security|violates/i);
    await expect(
      withTenantContext(
        restrictedPool,
        tenantA,
        ownerA,
        (client) =>
          insertConversationActionPlanPolicyReceipt(
            pgClientAsSqlClient(client),
            receiptInput({
              ...managerManualA,
              tenantId: tenantA,
              approvedByUserId: managerA,
              role: "manager",
              receiptFingerprint: "4".repeat(64),
            }),
          ),
      ),
    ).rejects.toThrow(/binding_invalid|row-level security|violates/i);
    await expect(
      withTenantContext(
        restrictedPool,
        tenantA,
        ownerA,
        (client) =>
          insertConversationActionPlanPolicyReceipt(
            pgClientAsSqlClient(client),
            receiptInput({
              ...manualB,
              tenantId: tenantB,
              approvedByUserId: ownerB,
              role: "owner",
              receiptFingerprint: "5".repeat(64),
            }),
          ),
      ),
    ).rejects.toThrow(/binding_invalid|row-level security|violates/i);

    const ownRows = await withTenantContext(
      restrictedPool,
      tenantA,
      ownerA,
      (client) =>
        client.query(
          `select plan_id
           from conversation_action_plan_policy_receipts
           order by plan_id`,
        ),
    );
    expect(ownRows.rows.map((row) => row.plan_id)).toEqual(
      [automaticA.planId, manualA.planId, servicePlan.id].sort(),
    );
    const crossRows = await withTenantContext(
      restrictedPool,
      tenantA,
      ownerA,
      (client) =>
        client.query(
          `select plan_id
           from conversation_action_plan_policy_receipts
           where tenant_id = $1`,
          [tenantB],
        ),
    );
    expect(crossRows.rows).toEqual([]);

    const update = await withTenantContext(
      restrictedPool,
      tenantA,
      ownerA,
      (client) =>
        client.query(
          `update conversation_action_plan_policy_receipts
           set receipt_fingerprint = $1
           where tenant_id = $2 and plan_id = $3
           returning plan_id`,
          ["6".repeat(64), tenantA, manualA.planId],
        ),
    );
    expect(update.rows).toEqual([]);
    const deletion = await withTenantContext(
      restrictedPool,
      tenantA,
      ownerA,
      (client) =>
        client.query(
          `delete from conversation_action_plan_policy_receipts
           where tenant_id = $1 and plan_id = $2
           returning plan_id`,
          [tenantA, manualA.planId],
        ),
    );
    expect(deletion.rows).toEqual([]);
    await expect(
      ownerDb.query(
        `update conversation_action_plan_policy_receipts
         set receipt_fingerprint = $1
         where tenant_id = $2 and plan_id = $3`,
        ["7".repeat(64), tenantA, manualA.planId],
      ),
    ).rejects.toThrow(/conversation_action_plan_policy_receipt_immutable/i);
    await expect(
      ownerDb.query(
        `delete from conversation_action_plan_policy_receipts
         where tenant_id = $1 and plan_id = $2`,
        [tenantA, manualA.planId],
      ),
    ).rejects.toThrow(/conversation_action_plan_policy_receipt_immutable/i);

    await ownerDb.query(`delete from tenants where id = $1`, [tenantA]);
    const cascadedRows = await ownerDb.query(
      `select
         (select count(*)::int
          from conversation_action_plan_policy_receipts
          where tenant_id = $1) as receipt_count,
         (select count(*)::int
          from conversation_action_plans
          where tenant_id = $1) as plan_count,
         (select count(*)::int
          from approvals
          where tenant_id = $1) as approval_count`,
      [tenantA],
    );
    expect(cascadedRows.rows).toEqual([
      { receipt_count: 0, plan_count: 0, approval_count: 0 },
    ]);
  });
});

type ApprovalMode = "none" | "single";
type MembershipRole = "owner" | "administrator" | "manager" | "collaborator";
type PlanSeed = {
  planId: string;
  approvalId: string | null;
  planFingerprint: string;
  approvalMode: ApprovalMode;
};

function receiptInput(
  input: PlanSeed & {
    tenantId: string;
    approvedByUserId: string;
    role: MembershipRole;
    receiptFingerprint: string;
  },
) {
  return {
    id: randomUUID(),
    tenantId: input.tenantId,
    planId: input.planId,
    planFingerprint: input.planFingerprint,
    approvalId: input.approvalId,
    approvalMode: input.approvalMode,
    approvedByUserId: input.approvedByUserId,
    payloadJson: JSON.stringify({
      schemaVersion: 1,
      tenantId: input.tenantId,
      plan: { id: input.planId, fingerprint: input.planFingerprint },
      approval:
        input.approvalMode === "single"
          ? { mode: "single", id: input.approvalId, status: "approved" }
          : { mode: "none", id: null, status: "not_required" },
      catalog: {
        fingerprint: "8".repeat(64),
        projection: {
          projectionSchemaVersion: 1,
          manifestSchemaVersion: 1,
          providerKey: "tradikom_mock",
          providerVersion: "1.0.0",
          executionEnvironment: "mock",
          status: "mock",
          auth: "none",
          allowedRoles: ["administrator", "collaborator", "manager", "owner"],
          capabilities: [{ name: "crm.contacts.search" }],
        },
      },
      provider: {
        key: "tradikom_mock",
        version: "1.0.0",
        executionEnvironment: "mock",
      },
      authorization: {
        role: input.role,
        allowedRoles: ["administrator", "collaborator", "manager", "owner"],
        requiredScopes:
          input.approvalMode === "single"
            ? ["crm.contacts.read", "project.tasks.write"]
            : ["crm.contacts.read"],
      },
      capabilities:
        input.approvalMode === "single"
          ? ["crm.contacts.search", "project.task.create"]
          : ["crm.contacts.search"],
      risk: {
        maximum: input.approvalMode === "single" ? "medium" : "low",
        steps:
          input.approvalMode === "single"
            ? [
                {
                  stepId: "search_contact",
                  capability: "crm.contacts.search",
                  level: "low",
                },
                {
                  stepId: "create_task",
                  capability: "project.task.create",
                  level: "medium",
                },
              ]
            : [
                {
                  stepId: "search_contact",
                  capability: "crm.contacts.search",
                  level: "low",
                },
              ],
      },
    }),
    receiptFingerprint: input.receiptFingerprint,
    createdAt: timestamp,
  };
}

async function seedConversationContext(
  ownerPool: Pool,
  input: {
    tenantId: string;
    tenantName: string;
    userIds: string[];
    roles: MembershipRole[];
    suffix: string;
  },
) {
  for (const [index, userId] of input.userIds.entries()) {
    await ownerPool.query(
      `insert into users (id, name, email, password_hash, created_at)
       values ($1, $2, $3, 'hash', $4)`,
      [
        userId,
        `Utilisateur Policy ${index}`,
        `${userId}@example.test`,
        timestamp,
      ],
    );
  }
  await ownerPool.query(
    `insert into tenants (id, name, slug, category, created_at)
     values ($1, $2, $1, 'Services', $3)`,
    [input.tenantId, input.tenantName, timestamp],
  );
  for (const [index, userId] of input.userIds.entries()) {
    await ownerPool.query(
      `insert into memberships (tenant_id, user_id, role, created_at)
       values ($1, $2, $3, $4)`,
      [input.tenantId, userId, input.roles[index], timestamp],
    );
  }
  const participantId = `participant_policy_rls_${input.suffix}`;
  const identityId = `identity_policy_rls_${input.suffix}`;
  const threadId = `thread_policy_rls_${input.suffix}`;
  const messageId = `message_policy_rls_${input.suffix}`;
  await ownerPool.query(
    `insert into conversation_participants (
       id, tenant_id, role, display_name, created_at, updated_at
     ) values ($1, $2, 'member', 'Membre', $3, $3)`,
    [participantId, input.tenantId, timestamp],
  );
  await ownerPool.query(
    `insert into conversation_channel_identities (
       id, tenant_id, participant_id, channel_kind, adapter_key,
       external_subject_id, display_name, role, state, created_at, updated_at
     ) values (
       $1, $2, $3, 'web', 'web-chat', $4, 'Membre', 'member', 'active', $5, $5
     )`,
    [identityId, input.tenantId, participantId, input.userIds[0], timestamp],
  );
  await ownerPool.query(
    `insert into conversation_threads (
       id, tenant_id, status, subject, confidentiality_level,
       visibility_scope, created_at, updated_at
     ) values ($1, $2, 'open', 'Policy', 'internal', 'tenant', $3, $3)`,
    [threadId, input.tenantId, timestamp],
  );
  await ownerPool.query(
    `insert into conversation_messages (
       id, tenant_id, thread_id, channel_identity_id, direction, kind, status,
       text_content, adapter_key, external_message_id, idempotency_key,
       correlation_id, occurred_at, created_at
     ) values (
       $1, $2, $3, $4, 'inbound', 'text', 'received', 'Préparer', 'web-chat',
       $5, $6, $7, $8, $8
     )`,
    [
      messageId,
      input.tenantId,
      threadId,
      identityId,
      `external_${input.suffix}`,
      `ingress:policy:${input.suffix}`,
      `correlation_policy_${input.suffix}`,
      timestamp,
    ],
  );
  return { threadId, messageId };
}

async function seedApprovedPlan(
  ownerPool: Pool,
  input: {
    tenantId: string;
    userId: string;
    threadId: string;
    messageId: string;
    planId: string;
    approvalId: string | null;
    planFingerprint: string;
    approvalMode: ApprovalMode;
  },
): Promise<PlanSeed> {
  await ownerPool.query(
    `insert into conversation_action_plans (
       id, tenant_id, thread_id, source_message_id, schema_version,
       generation_source, approval_status, intent, business_goal, confidence,
       risk_summary, estimated_cost_minor, estimated_cost_currency, plan_json,
       plan_fingerprint, created_by, created_at, updated_at, decided_by,
       decided_at, decision_reason
     ) values (
       $1, $2, $3, $4, 1, 'deterministic_mock', 'approved', 'Préparer',
       'Créer un suivi', 0.95, 'Risque borné', 0, 'EUR', '{}', $5, $6, $7,
       $7, $6, $7, 'Policy validée'
     )`,
    [
      input.planId,
      input.tenantId,
      input.threadId,
      input.messageId,
      input.planFingerprint,
      input.userId,
      timestamp,
    ],
  );
  if (input.approvalId) {
    await ownerPool.query(
      `insert into approvals (
         id, tenant_id, requested_by, policy, status, target_type, target_id,
         created_at
       ) values (
         $1, $2, $3, 'single', 'approved', 'conversation_action_plan', $4, $5
       )`,
      [
        input.approvalId,
        input.tenantId,
        input.userId,
        input.planId,
        timestamp,
      ],
    );
  }
  return {
    planId: input.planId,
    approvalId: input.approvalId,
    planFingerprint: input.planFingerprint,
    approvalMode: input.approvalMode,
  };
}

async function createRestrictedRole(ownerPool: Pool) {
  if (!databaseUrl) throw new Error("DATABASE_URL est requis.");
  const roleName = `tradikom_policy_receipt_${randomUUID().replaceAll("-", "")}`;
  const password = randomUUID().replaceAll("-", "");
  const roleIdentifier = quoteIdentifier(roleName);
  await ownerPool.query(
    `create role ${roleIdentifier} login password ${quoteLiteral(password)}`,
  );
  await ownerPool.query(`grant usage on schema public to ${roleIdentifier}`);
  await ownerPool.query(
    `grant select, insert, update, delete on all tables in schema public to ${roleIdentifier}`,
  );
  const restrictedUrl = new URL(databaseUrl);
  restrictedUrl.username = roleName;
  restrictedUrl.password = password;
  return { roleName, databaseUrl: restrictedUrl.toString() };
}

async function createTrustedRuntimeRole(ownerPool: Pool) {
  if (!databaseUrl) throw new Error("DATABASE_URL est requis.");
  const roleName = `tradikom_policy_runtime_${randomUUID().replaceAll("-", "")}`;
  const password = randomUUID().replaceAll("-", "");
  const roleIdentifier = quoteIdentifier(roleName);
  const owner = await ownerPool.query<{ role_name: string }>(
    "select current_user as role_name",
  );
  const ownerIdentifier = quoteIdentifier(owner.rows[0]!.role_name);
  await ownerPool.query(
    `create role ${roleIdentifier} login nosuperuser nobypassrls noinherit password ${quoteLiteral(password)}`,
  );
  try {
    await ownerPool.query(`grant usage on schema public to ${roleIdentifier}`);
    await ownerPool.query(
      `grant select, insert, update, delete on all tables in schema public to ${roleIdentifier}`,
    );
    await ownerPool.query(`grant ${ownerIdentifier} to ${roleIdentifier}`);
    const runtimeUrl = new URL(databaseUrl);
    runtimeUrl.username = roleName;
    runtimeUrl.password = password;
    return { roleName, databaseUrl: runtimeUrl.toString() };
  } catch (error) {
    try {
      await dropRestrictedRole(ownerPool, roleName);
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        `Impossible de préparer puis nettoyer le rôle PostgreSQL ${roleName}.`,
      );
    }
    throw error;
  }
}

async function dropRestrictedRole(ownerPool: Pool, roleName: string) {
  const roleIdentifier = quoteIdentifier(roleName);
  await ownerPool.query(`drop owned by ${roleIdentifier}`);
  await ownerPool.query(`drop role if exists ${roleIdentifier}`);
}

async function withTenantContext<T>(
  pool: Pool,
  tenantId: string,
  actorId: string,
  callback: (client: PoolClient) => Promise<T>,
) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    await client.query("select set_config('app.actor_id', $1, true)", [actorId]);
    const result = await callback(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function withTenantSystemContext<T>(
  pool: Pool,
  tenantId: string,
  actorId: string,
  callback: (client: PoolClient) => Promise<T>,
) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    await client.query("select set_config('app.actor_id', $1, true)", [actorId]);
    await client.query("select set_config('app.system_access', 'true', true)");
    const result = await callback(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function withForcedConversationPolicyRls<T>(
  db: SqlClient,
  callback: () => Promise<T>,
) {
  const tables = [
    "conversation_action_plans",
    "conversation_action_plan_steps",
    "approvals",
    "conversation_action_plan_policy_receipts",
  ] as const;
  for (const table of tables) {
    await db.query(`alter table ${table} force row level security`);
  }
  try {
    return await callback();
  } finally {
    for (const table of tables.toReversed()) {
      await db.query(`alter table ${table} no force row level security`);
    }
  }
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}
