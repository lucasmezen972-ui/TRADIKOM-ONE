import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { pgPoolAsSqlClient } from "../src/db/client";
import { migrate } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import { ingestConversationMessage } from "../src/modules/conversation-hub";
import {
  createConversationActionPlan,
  delegateConversationActionPlan,
} from "../src/modules/orchestrator";

const databaseUrl = process.env.DATABASE_URL;
const describeIfPostgres = databaseUrl ? describe : describe.skip;
const ownerPools: Pool[] = [];
const restrictedPools: Pool[] = [];
const restrictedRoles: Array<{ ownerPool: Pool; roleName: string }> = [];
const fixtures: Fixture[] = [];
const occurredAt = "2026-09-14T10:00:00.000Z";

type Fixture = {
  ownerPool: Pool;
  tenantId: string;
  ownerId: string;
  managerIds: string[];
  threadId: string;
  planId: string;
};

afterEach(async () => {
  const failures: unknown[] = [];
  for (const pool of restrictedPools.splice(0)) {
    try {
      await pool.end();
    } catch (error) {
      failures.push(error);
    }
  }
  for (const role of restrictedRoles.splice(0)) {
    try {
      await dropRestrictedRole(role.ownerPool, role.roleName);
    } catch (error) {
      failures.push(error);
    }
  }
  for (const fixture of fixtures.splice(0).reverse()) {
    try {
      await fixture.ownerPool.query("delete from tenants where id = $1", [
        fixture.tenantId,
      ]);
      await fixture.ownerPool.query(
        "delete from users where id = any($1::text[])",
        [[fixture.ownerId, ...fixture.managerIds]],
      );
    } catch (error) {
      failures.push(error);
    }
  }
  for (const pool of ownerPools.splice(0)) {
    try {
      await pool.end();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length > 0) {
    throw new AggregateError(
      failures,
      "Le nettoyage PostgreSQL des délégations a échoué.",
    );
  }
});

describeIfPostgres("délégations Conversation et RLS PostgreSQL", () => {
  it("autorise la lecture tenant-aware et refuse toutes les écritures directes", async () => {
    if (!databaseUrl) throw new Error("DATABASE_URL est requis.");
    const ownerPool = new Pool({ connectionString: databaseUrl });
    ownerPools.push(ownerPool);
    const ownerDb = pgPoolAsSqlClient(ownerPool);
    await migrate(ownerDb, { enableRls: true });
    const fixtureA = await createFixture(ownerPool, "rls-a", 1);
    const fixtureB = await createFixture(ownerPool, "rls-b", 1);
    const delegationA = await delegateConversationActionPlan(
      ownerDb,
      fixtureA.ownerId,
      fixtureA.tenantId,
      {
        planId: fixtureA.planId,
        delegatedToUserId: fixtureA.managerIds[0]!,
        expectedDelegationVersion: 0,
        idempotencyKey: `delegation:postgres:rls:a:${randomUUID()}`,
        confirmed: true,
      },
    );
    const delegationB = await delegateConversationActionPlan(
      ownerDb,
      fixtureB.ownerId,
      fixtureB.tenantId,
      {
        planId: fixtureB.planId,
        delegatedToUserId: fixtureB.managerIds[0]!,
        expectedDelegationVersion: 0,
        idempotencyKey: `delegation:postgres:rls:b:${randomUUID()}`,
        confirmed: true,
      },
    );

    const restricted = await createRestrictedRole(ownerPool);
    restrictedRoles.push({ ownerPool, roleName: restricted.roleName });
    const restrictedPool = new Pool({ connectionString: restricted.databaseUrl });
    restrictedPools.push(restrictedPool);

    const visibleA = await withTenantContext(
      restrictedPool,
      fixtureA.tenantId,
      fixtureA.ownerId,
      (client) =>
        client.query<{ id: string; tenant_id: string }>(
          `select id, tenant_id
           from conversation_action_plan_delegations
           order by id`,
        ),
    );
    expect(visibleA.rows).toEqual([
      {
        id: delegationA.delegation!.id,
        tenant_id: fixtureA.tenantId,
      },
    ]);
    expect(visibleA.rows.map((row) => row.id)).not.toContain(
      delegationB.delegation!.id,
    );

    const visibleB = await withTenantContext(
      restrictedPool,
      fixtureB.tenantId,
      fixtureB.managerIds[0]!,
      (client) =>
        client.query<{ id: string }>(
          "select id from conversation_action_plan_delegations order by id",
        ),
    );
    expect(visibleB.rows).toEqual([{ id: delegationB.delegation!.id }]);

    await expect(
      withTenantContext(
        restrictedPool,
        fixtureA.tenantId,
        fixtureA.managerIds[0]!,
        (client) =>
          client.query(
            `insert into conversation_action_plan_delegations (
               id, tenant_id, plan_id, plan_fingerprint, approval_id,
               approval_target_type, version, expected_previous_version,
               delegated_by_user_id, delegated_to_user_id, delegated_to_role,
               idempotency_key_hash, request_fingerprint, created_at
             ) select
               $2, tenant_id, plan_id, plan_fingerprint, approval_id,
               approval_target_type, 2, 1, delegated_to_user_id, $3, 'owner',
               $4, $5, created_at
             from conversation_action_plan_delegations
             where tenant_id = $1 and id = $6`,
            [
              fixtureA.tenantId,
              `delegation_rls_direct_${randomUUID().replaceAll("-", "")}`,
              fixtureA.ownerId,
              "a".repeat(64),
              "b".repeat(64),
              delegationA.delegation!.id,
            ],
          ),
      ),
    ).rejects.toThrow(/row-level security|violates/i);

    const updated = await withTenantContext(
      restrictedPool,
      fixtureA.tenantId,
      fixtureA.ownerId,
      (client) =>
        client.query(
          `update conversation_action_plan_delegations
           set delegated_to_role = 'owner'
           where id = $1 returning id`,
          [delegationA.delegation!.id],
        ),
    );
    expect(updated.rows).toEqual([]);
    const deleted = await withTenantContext(
      restrictedPool,
      fixtureA.tenantId,
      fixtureA.ownerId,
      (client) =>
        client.query(
          `delete from conversation_action_plan_delegations
           where id = $1 returning id`,
          [delegationA.delegation!.id],
        ),
    );
    expect(deleted.rows).toEqual([]);

    const persisted = await ownerPool.query<{ count: number }>(
      `select count(*)::int as count
       from conversation_action_plan_delegations
       where tenant_id = $1 and id = $2`,
      [fixtureA.tenantId, delegationA.delegation!.id],
    );
    expect(persisted.rows).toEqual([{ count: 1 }]);
  });

  it("sérialise le même rejeu et deux délégations concurrentes distinctes", async () => {
    if (!databaseUrl) throw new Error("DATABASE_URL est requis.");
    const primaryPool = new Pool({ connectionString: databaseUrl, max: 1 });
    const contenderPool = new Pool({ connectionString: databaseUrl, max: 1 });
    ownerPools.push(primaryPool, contenderPool);
    const primaryDb = pgPoolAsSqlClient(primaryPool);
    const contenderDb = pgPoolAsSqlClient(contenderPool);
    await migrate(primaryDb, { enableRls: true });

    const sameFixture = await createFixture(primaryPool, "race-same", 1);
    const sameInput = {
      planId: sameFixture.planId,
      delegatedToUserId: sameFixture.managerIds[0]!,
      expectedDelegationVersion: 0,
      idempotencyKey: `delegation:postgres:same:${randomUUID()}`,
      confirmed: true as const,
    };
    const sameResults = await Promise.all([
      delegateConversationActionPlan(
        primaryDb,
        sameFixture.ownerId,
        sameFixture.tenantId,
        sameInput,
      ),
      delegateConversationActionPlan(
        contenderDb,
        sameFixture.ownerId,
        sameFixture.tenantId,
        sameInput,
      ),
    ]);
    expect(new Set(sameResults.map((result) => result.delegation?.id)).size).toBe(
      1,
    );
    expect(
      sameResults
        .map((result) => result.idempotentReplay)
        .sort((left, right) => Number(left) - Number(right)),
    ).toEqual([false, true]);

    const distinctFixture = await createFixture(primaryPool, "race-distinct", 2);
    const distinctResults = await Promise.allSettled([
      delegateConversationActionPlan(
        primaryDb,
        distinctFixture.ownerId,
        distinctFixture.tenantId,
        {
          planId: distinctFixture.planId,
          delegatedToUserId: distinctFixture.managerIds[0]!,
          expectedDelegationVersion: 0,
          idempotencyKey: `delegation:postgres:distinct:a:${randomUUID()}`,
          confirmed: true,
        },
      ),
      delegateConversationActionPlan(
        contenderDb,
        distinctFixture.ownerId,
        distinctFixture.tenantId,
        {
          planId: distinctFixture.planId,
          delegatedToUserId: distinctFixture.managerIds[1]!,
          expectedDelegationVersion: 0,
          idempotencyKey: `delegation:postgres:distinct:b:${randomUUID()}`,
          confirmed: true,
        },
      ),
    ]);
    expect(
      distinctResults.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const rejected = distinctResults.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );
    expect(rejected?.reason).toMatchObject({
      code: "orchestrator_decision_conflict",
    });

    const evidence = await primaryPool.query<{
      tenant_id: string;
      delegations: number;
      audits: number;
    }>(
      `select tenant.id as tenant_id,
         (select count(*)::int from conversation_action_plan_delegations d
          where d.tenant_id = tenant.id) as delegations,
         (select count(*)::int from audit_logs audit
          where audit.tenant_id = tenant.id
            and audit.action = 'conversation.plan_delegated') as audits
       from tenants tenant
       where tenant.id in ($1, $2)
       order by tenant.id`,
      [sameFixture.tenantId, distinctFixture.tenantId],
    );
    expect(evidence.rows).toEqual(
      expect.arrayContaining([
        {
          tenant_id: sameFixture.tenantId,
          delegations: 1,
          audits: 1,
        },
        {
          tenant_id: distinctFixture.tenantId,
          delegations: 1,
          audits: 1,
        },
      ]),
    );
  });
});

async function createFixture(ownerPool: Pool, label: string, managerCount: number) {
  const db = pgPoolAsSqlClient(ownerPool);
  const services = createServices(db);
  const unique = randomUUID().replaceAll("-", "");
  const owner = await services.registerUser({
    name: `Propriétaire ${label}`,
    email: `delegation-${label}-owner-${unique}@example.test`,
    password: "Password!1",
  });
  const tenant = await services.createTenant(owner.id, {
    name: `Organisation ${label} ${unique}`,
    category: "Services",
  });
  const managerIds: string[] = [];
  for (let index = 0; index < managerCount; index += 1) {
    const manager = await services.registerUser({
      name: `Responsable ${label} ${index + 1}`,
      email: `delegation-${label}-manager-${index}-${unique}@example.test`,
      password: "Password!1",
    });
    managerIds.push(manager.id);
    await ownerPool.query(
      `insert into memberships (tenant_id, user_id, role, created_at)
       values ($1, $2, 'manager', $3)`,
      [tenant.id, manager.id, occurredAt],
    );
  }
  const source = await ingestConversationMessage(db, owner.id, {
    tenantId: tenant.id,
    channelIdentity: {
      id: `identity_delegation_${unique}`,
      tenantId: tenant.id,
      participantId: `participant_delegation_${unique}`,
      channelKind: "web",
      adapterKey: "web-chat",
      externalSubjectId: `member_delegation_${unique}`,
      displayName: "Membre de démonstration",
      role: "member",
      state: "active",
      createdAt: occurredAt,
      updatedAt: occurredAt,
    },
    externalMessageId: `external_delegation_${unique}`,
    idempotencyKey: `ingress:delegation:${unique}`,
    correlationId: `correlation_delegation_${unique}`,
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
  const fixture = {
    ownerPool,
    tenantId: tenant.id,
    ownerId: owner.id,
    managerIds,
    threadId: source.threadId,
    planId: plan.id,
  };
  fixtures.push(fixture);
  return fixture;
}

async function createRestrictedRole(ownerPool: Pool) {
  if (!databaseUrl) throw new Error("DATABASE_URL est requis.");
  const roleName = `tradikom_delegation_${randomUUID().replaceAll("-", "")}`;
  const password = randomUUID().replaceAll("-", "");
  const roleIdentifier = quoteIdentifier(roleName);
  await ownerPool.query(
    `create role ${roleIdentifier} login nosuperuser nobypassrls password ${quoteLiteral(password)}`,
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

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}
