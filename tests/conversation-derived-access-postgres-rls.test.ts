import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { pgPoolAsSqlClient } from "../src/db/client";
import { migrate } from "../src/lib/db";

const databaseUrl = process.env.DATABASE_URL;
const describeIfPostgres = databaseUrl ? describe : describe.skip;
const ownerPools: Pool[] = [];
const restrictedPools: Pool[] = [];
const restrictedRoles: Array<{ ownerPool: Pool; roleName: string }> = [];
const timestamp = "2026-09-04T23:10:00.000Z";

afterEach(async () => {
  await Promise.all(restrictedPools.splice(0).map((pool) => pool.end()));
  for (const role of restrictedRoles.splice(0)) {
    await dropRestrictedRole(role.ownerPool, role.roleName);
  }
  await Promise.all(ownerPools.splice(0).map((pool) => pool.end()));
});

describeIfPostgres("RLS PostgreSQL des objets dérivés de Conversation", () => {
  it("hérite le droit du fil sans masquer les workflows génériques", async () => {
    if (!databaseUrl) throw new Error("DATABASE_URL est requis.");
    const ownerPool = new Pool({ connectionString: databaseUrl });
    ownerPools.push(ownerPool);
    const ownerDb = pgPoolAsSqlClient(ownerPool);
    await migrate(ownerDb, { enableRls: true });
    const fixture = await seedFixture(ownerDb, randomUUID().replaceAll("-", ""));
    const restricted = await createRestrictedRole(ownerPool);
    restrictedRoles.push({ ownerPool, roleName: restricted.roleName });
    const restrictedPool = new Pool({ connectionString: restricted.databaseUrl });
    restrictedPools.push(restrictedPool);

    const allowed = await readVisibleIds(
      restrictedPool,
      fixture.tenantA,
      fixture.allowedA,
    );
    expect(allowed).toEqual({
      threads: [fixture.protectedThread, fixture.tenantThread].sort(),
      threadParticipants: [fixture.protectedThread, fixture.tenantThread].sort(),
      messages: [fixture.protectedMessage, fixture.tenantMessage].sort(),
      attachments: [fixture.protectedAttachment, fixture.tenantAttachment].sort(),
      routeHops: [fixture.protectedMessage, fixture.tenantMessage].sort(),
      plans: [fixture.plan],
      planSteps: [fixture.plan],
      workflowRuns: [fixture.conversationRun, fixture.genericRun].sort(),
      workflowRunSteps: [fixture.conversationRun, fixture.genericRun].sort(),
      approvals: [fixture.conversationApproval, fixture.genericApproval].sort(),
      events: [
        fixture.genericEvent,
        fixture.genericRunEvent,
        fixture.legacyResumeEvent,
        fixture.planEvent,
        fixture.resumeEvent,
      ].sort(),
    });

    const denied = await readVisibleIds(
      restrictedPool,
      fixture.tenantA,
      fixture.deniedA,
    );
    expect(denied).toEqual({
      threads: [fixture.tenantThread],
      threadParticipants: [fixture.tenantThread],
      messages: [fixture.tenantMessage],
      attachments: [fixture.tenantAttachment],
      routeHops: [fixture.tenantMessage],
      plans: [],
      planSteps: [],
      workflowRuns: [fixture.genericRun],
      workflowRunSteps: [fixture.genericRun],
      approvals: [fixture.genericApproval],
      events: [
        fixture.genericEvent,
        fixture.genericRunEvent,
        fixture.legacyResumeEvent,
      ].sort(),
    });

    const crossTenant = await withContext(
      restrictedPool,
      fixture.tenantA,
      fixture.allowedA,
      (client) => client.query(
        "select id from conversation_threads where tenant_id = $1",
        [fixture.tenantB],
      ),
    );
    expect(crossTenant.rows).toEqual([]);

    const forgedSystem = await withContext(
      restrictedPool,
      fixture.tenantA,
      fixture.deniedA,
      (client) => client.query(
        "select id from conversation_threads where id = $1",
        [fixture.protectedThread],
      ),
      true,
    );
    expect(forgedSystem.rows).toEqual([]);

    await expect(
      withContext(
        restrictedPool,
        fixture.tenantA,
        fixture.deniedA,
        (client) => client.query(
          `insert into conversation_messages (
             id, tenant_id, thread_id, channel_identity_id, direction, kind,
             status, text_content, adapter_key, external_message_id,
             idempotency_key, correlation_id, causation_id, safe_error_code,
             occurred_at, created_at
           ) values (
             $1, $2, $3, $4, 'internal', 'text', 'received', 'Refusée',
             'test', null, $5, $6, null, null, $7, $7
           )`,
          [
            `message_denied_${fixture.unique}`,
            fixture.tenantA,
            fixture.protectedThread,
            fixture.identity,
            `denied-idempotency-${fixture.unique}`,
            `denied-correlation-${fixture.unique}`,
            timestamp,
          ],
        ),
      ),
    ).rejects.toThrow(/row-level security|violates/i);

    const deniedPlanUpdate = await withContext(
      restrictedPool,
      fixture.tenantA,
      fixture.deniedA,
      (client) => client.query(
        `update conversation_action_plans
         set approval_status = 'rejected', decided_by = $1, decided_at = $2,
             decision_reason = 'Refus direct', updated_at = $2
         where id = $3 returning id`,
        [fixture.deniedA, timestamp, fixture.plan],
      ),
    );
    expect(deniedPlanUpdate.rows).toEqual([]);

    const deniedAttachmentDelete = await withContext(
      restrictedPool,
      fixture.tenantA,
      fixture.deniedA,
      (client) => client.query(
        "delete from conversation_message_attachments where id = $1 returning id",
        [fixture.protectedAttachment],
      ),
    );
    expect(deniedAttachmentDelete.rows).toEqual([]);

    const allowedMessageUpdate = await withContext(
      restrictedPool,
      fixture.tenantA,
      fixture.allowedA,
      (client) => client.query(
        `update conversation_messages
         set status = 'sent' where id = $1 returning id, status`,
        [fixture.protectedMessage],
      ),
    );
    expect(allowedMessageUpdate.rows).toEqual([{
      id: fixture.protectedMessage,
      status: "sent",
    }]);

    const intact = await ownerDb.query<{ plans: number; attachments: number }>(
      `select
         (select count(*)::int from conversation_action_plans where id = $1) as plans,
         (select count(*)::int from conversation_message_attachments where id = $2)
           as attachments`,
      [fixture.plan, fixture.protectedAttachment],
    );
    expect(intact.rows[0]).toEqual({ plans: 1, attachments: 1 });
  });
});

async function seedFixture(
  db: ReturnType<typeof pgPoolAsSqlClient>,
  unique: string,
) {
  const tenantA = `tenant_derived_rls_a_${unique}`;
  const tenantB = `tenant_derived_rls_b_${unique}`;
  const allowedA = `user_derived_rls_allowed_${unique}`;
  const deniedA = `user_derived_rls_denied_${unique}`;
  const ownerB = `user_derived_rls_b_${unique}`;
  const participant = `participant_derived_rls_${unique}`;
  const identity = `identity_derived_rls_${unique}`;
  const protectedThread = `thread_derived_rls_protected_${unique}`;
  const tenantThread = `thread_derived_rls_tenant_${unique}`;
  const otherThread = `thread_derived_rls_other_${unique}`;
  const protectedMessage = `message_derived_rls_protected_${unique}`;
  const tenantMessage = `message_derived_rls_tenant_${unique}`;
  const protectedAttachment = `attachment_derived_rls_protected_${unique}`;
  const tenantAttachment = `attachment_derived_rls_tenant_${unique}`;
  const plan = `plan_derived_rls_${unique}`;
  const conversationRun = `run_derived_rls_conversation_${unique}`;
  const genericRun = `run_derived_rls_generic_${unique}`;
  const conversationApproval = `approval_derived_rls_conversation_${unique}`;
  const genericApproval = `approval_derived_rls_generic_${unique}`;
  const planEvent = `event_derived_rls_plan_${unique}`;
  const resumeEvent = `event_derived_rls_resume_${unique}`;
  const genericEvent = `event_derived_rls_generic_${unique}`;
  const genericRunEvent = `event_derived_rls_generic_run_${unique}`;
  const legacyResumeEvent = `event_derived_rls_legacy_resume_${unique}`;

  await db.query(
    `insert into users (id, name, email, password_hash, created_at)
     values
       ($1, 'Autorisée', $1 || '@example.test', 'hash', $4),
       ($2, 'Non autorisée', $2 || '@example.test', 'hash', $4),
       ($3, 'Autre tenant', $3 || '@example.test', 'hash', $4)`,
    [allowedA, deniedA, ownerB, timestamp],
  );
  await db.query(
    `insert into tenants (id, name, slug, category, created_at)
     values
       ($1, 'Organisation A', $1, 'Services', $3),
       ($2, 'Organisation B', $2, 'Services', $3)`,
    [tenantA, tenantB, timestamp],
  );
  await db.query(
    `insert into memberships (tenant_id, user_id, role, created_at)
     values
       ($1, $2, 'collaborator', $5),
       ($1, $3, 'collaborator', $5),
       ($4, $6, 'owner', $5)`,
    [tenantA, allowedA, deniedA, tenantB, timestamp, ownerB],
  );
  await db.query(
    `insert into conversation_participants (
       id, tenant_id, role, display_name, created_at, updated_at
     ) values ($1, $2, 'member', 'Participant test', $3, $3)`,
    [participant, tenantA, timestamp],
  );
  await db.query(
    `insert into conversation_channel_identities (
       id, tenant_id, participant_id, channel_kind, adapter_key,
       external_subject_id, display_name, role, state, created_at, updated_at
     ) values (
       $1, $2, $3, 'test', 'test', $4, 'Identité test', 'member', 'active',
       $5, $5
     )`,
    [identity, tenantA, participant, `subject_${unique}`, timestamp],
  );
  await db.query(
    `insert into conversation_threads (
       id, tenant_id, status, subject, confidentiality_level, visibility_scope,
       created_at, updated_at
     ) values
       ($1, $2, 'open', null, 'restricted', 'team', $7, $7),
       ($3, $2, 'open', null, 'internal', 'tenant', $7, $7),
       ($4, $5, 'open', null, 'secret', 'personal', $7, $7)`,
    [protectedThread, tenantA, tenantThread, otherThread, tenantB, ownerB, timestamp],
  );
  await db.query(
    `insert into conversation_thread_access_grants (
       tenant_id, thread_id, user_id, scope, granted_by_user_id, granted_at
     ) values ($1, $2, $3, 'team', $3, $4)`,
    [tenantA, protectedThread, allowedA, timestamp],
  );
  await db.query(
    `insert into conversation_thread_participants (
       tenant_id, thread_id, channel_identity_id, joined_at
     ) values ($1, $2, $4, $5), ($1, $3, $4, $5)`,
    [tenantA, protectedThread, tenantThread, identity, timestamp],
  );
  await db.query(
    `insert into conversation_messages (
       id, tenant_id, thread_id, channel_identity_id, direction, kind, status,
       text_content, adapter_key, external_message_id, idempotency_key,
       correlation_id, causation_id, safe_error_code, occurred_at, created_at
     ) values
       ($1, $2, $3, $7, 'internal', 'text', 'received', 'Protégé', 'test',
        null, $8, $9, null, null, $10, $10),
       ($4, $2, $5, $7, 'internal', 'text', 'received', 'Tenant', 'test',
        null, $11, $12, null, null, $10, $10)`,
    [
      protectedMessage,
      tenantA,
      protectedThread,
      tenantMessage,
      tenantThread,
      unique,
      identity,
      `protected-idempotency-${unique}`,
      `protected-correlation-${unique}`,
      timestamp,
      `tenant-idempotency-${unique}`,
      `tenant-correlation-${unique}`,
    ],
  );
  await db.query(
    `insert into conversation_message_attachments (
       id, tenant_id, message_id, kind, file_name, media_type, size_bytes,
       storage_reference, checksum_sha256, created_at
     ) values
       ($1, $2, $3, 'document', 'protege.txt', 'text/plain', 8, $7, $8, $9),
       ($4, $2, $5, 'document', 'tenant.txt', 'text/plain', 6, $10, $11, $9)`,
    [
      protectedAttachment,
      tenantA,
      protectedMessage,
      tenantAttachment,
      tenantMessage,
      unique,
      `mock://protected/${unique}`,
      "a".repeat(64),
      timestamp,
      `mock://tenant/${unique}`,
      "b".repeat(64),
    ],
  );
  await db.query(
    `insert into conversation_message_route_hops (
       tenant_id, message_id, position, adapter_key, channel_identity_id,
       external_message_id
     ) values
       ($1, $2, 0, 'test', $4, null),
       ($1, $3, 0, 'test', $4, null)`,
    [tenantA, protectedMessage, tenantMessage, identity],
  );
  await db.query(
    `insert into conversation_action_plans (
       id, tenant_id, thread_id, source_message_id, schema_version,
       generation_source, model_reference, approval_status, intent,
       business_goal, confidence, risk_summary, estimated_cost_minor,
       estimated_cost_currency, plan_json, plan_fingerprint, created_by,
       created_at, updated_at
     ) values (
       $1, $2, $3, $4, 1, 'deterministic_mock', null, 'awaiting_approval',
       'Tester la RLS', 'Protéger le fil', 1, 'Risque faible', 0, 'EUR', '{}',
       $5, $6, $7, $7
     )`,
    [plan, tenantA, protectedThread, protectedMessage, "c".repeat(64), allowedA, timestamp],
  );
  await db.query(
    `insert into conversation_action_plan_steps (
       tenant_id, plan_id, position, step_id, capability, mode,
       execution_environment, risk, requires_approval, reversible, input_json,
       evidence_required_json, idempotency_key, status
     ) values (
       $1, $2, 0, 'step_rls', 'conversation.test', 'write', 'mock', 'low', 1,
       'true', '{}', '[]', $3, 'planned'
     )`,
    [tenantA, plan, `plan-step-${unique}`],
  );
  await db.query(
    `insert into workflow_runs (
       id, tenant_id, workflow_key, trigger_name, status, summary, error,
       retry_count, created_at
     ) values
       ($1, $2, $3, 'conversation.plan.execute', 'running', 'Plan', null, 0, $6),
       ($4, $2, 'generic.workflow', 'generic.event', 'running', 'Générique', null, 0, $6)`,
    [conversationRun, tenantA, `conversation_plan:${plan}`, genericRun, unique, timestamp],
  );
  await db.query(
    `insert into workflow_run_steps (
       id, tenant_id, workflow_run_id, action_name, status, safe_metadata,
       created_at
     ) values
       ($1, $2, $3, 'conversation.test', 'running', '{}', $6),
       ($4, $2, $5, 'generic.test', 'running', '{}', $6)`,
    [
      `run_step_conversation_${unique}`,
      tenantA,
      conversationRun,
      `run_step_generic_${unique}`,
      genericRun,
      timestamp,
    ],
  );
  await db.query(
    `insert into approvals (
       id, tenant_id, requested_by, policy, status, target_type, target_id,
       created_at
     ) values
       ($1, $2, $3, 'explicit', 'pending', 'conversation_action_plan', $4, $7),
       ($5, $2, $3, 'explicit', 'pending', 'generic_workflow', $6, $7)`,
    [
      conversationApproval,
      tenantA,
      allowedA,
      plan,
      genericApproval,
      genericRun,
      timestamp,
    ],
  );
  for (const event of [
    { id: planEvent, type: "conversation.plan.execute", payload: { planId: plan } },
    { id: resumeEvent, type: "workflow.resume", payload: { runId: conversationRun } },
    { id: genericEvent, type: "generic.event", payload: { source: "test" } },
    { id: genericRunEvent, type: "workflow.resume", payload: { runId: genericRun } },
    { id: legacyResumeEvent, type: "workflow.resume", payload: {} },
  ]) {
    await db.query(
      `insert into domain_events (
         id, tenant_id, actor_id, event_type, payload, status, attempts,
         idempotency_key, correlation_id, causation_id, next_run_at, last_error,
         created_at, updated_at
       ) values (
         $1, $2, $3, $4, $5, 'pending', 0, $6, $7, null, $8, null, $8, $8
       )`,
      [
        event.id,
        tenantA,
        allowedA,
        event.type,
        JSON.stringify(event.payload),
        `event-idempotency-${event.id}`,
        `event-correlation-${event.id}`,
        timestamp,
      ],
    );
  }

  return {
    unique,
    tenantA,
    tenantB,
    allowedA,
    deniedA,
    identity,
    protectedThread,
    tenantThread,
    protectedMessage,
    tenantMessage,
    protectedAttachment,
    tenantAttachment,
    plan,
    conversationRun,
    genericRun,
    conversationApproval,
    genericApproval,
    planEvent,
    resumeEvent,
    genericEvent,
    genericRunEvent,
    legacyResumeEvent,
  };
}

async function readVisibleIds(pool: Pool, tenantId: string, actorId: string) {
  return withContext(pool, tenantId, actorId, async (client) => ({
    threads: await ids(client, "conversation_threads", "id"),
    threadParticipants: await ids(
      client,
      "conversation_thread_participants",
      "thread_id",
    ),
    messages: await ids(client, "conversation_messages", "id"),
    attachments: await ids(client, "conversation_message_attachments", "id"),
    routeHops: await ids(client, "conversation_message_route_hops", "message_id"),
    plans: await ids(client, "conversation_action_plans", "id"),
    planSteps: await ids(client, "conversation_action_plan_steps", "plan_id"),
    workflowRuns: await ids(client, "workflow_runs", "id"),
    workflowRunSteps: await ids(client, "workflow_run_steps", "workflow_run_id"),
    approvals: await ids(client, "approvals", "id"),
    events: await ids(client, "domain_events", "id"),
  }));
}

async function ids(client: PoolClient, table: string, column: string) {
  const result = await client.query<{ id: string }>(
    `select ${quoteIdentifier(column)} as id from ${quoteIdentifier(table)} order by id`,
  );
  return result.rows.map((row) => row.id);
}

async function createRestrictedRole(ownerPool: Pool) {
  if (!databaseUrl) throw new Error("DATABASE_URL est requis.");
  const roleName = `tradikom_derived_rls_${randomUUID().replaceAll("-", "")}`;
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

async function dropRestrictedRole(ownerPool: Pool, roleName: string) {
  const roleIdentifier = quoteIdentifier(roleName);
  await ownerPool.query(`drop owned by ${roleIdentifier}`);
  await ownerPool.query(`drop role if exists ${roleIdentifier}`);
}

async function withContext<T>(
  pool: Pool,
  tenantId: string,
  actorId: string,
  callback: (client: PoolClient) => Promise<T>,
  systemAccess = false,
) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    await client.query("select set_config('app.actor_id', $1, true)", [actorId]);
    if (systemAccess) {
      await client.query("select set_config('app.system_access', 'true', true)");
    }
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
