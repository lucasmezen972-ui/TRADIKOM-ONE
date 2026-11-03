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
const timestamp = "2026-09-11T05:00:00.000Z";

afterEach(async () => {
  await Promise.all(restrictedPools.splice(0).map((pool) => pool.end()));
  for (const role of restrictedRoles.splice(0)) {
    await dropRestrictedRole(role.ownerPool, role.roleName);
  }
  await Promise.all(ownerPools.splice(0).map((pool) => pool.end()));
});

describeIfPostgres("RLS PostgreSQL des écritures workflow Conversation", () => {
  it("réserve les preuves Conversation au système sans gêner les workflows génériques", async () => {
    if (!databaseUrl) throw new Error("DATABASE_URL est requis.");
    const ownerPool = new Pool({ connectionString: databaseUrl });
    ownerPools.push(ownerPool);
    const ownerDb = pgPoolAsSqlClient(ownerPool);
    await migrate(ownerDb, { enableRls: true });

    const fixture = await seedFixture(
      ownerPool,
      randomUUID().replaceAll("-", ""),
    );
    const restricted = await createRestrictedRole(ownerPool);
    restrictedRoles.push({ ownerPool, roleName: restricted.roleName });
    const restrictedPool = new Pool({ connectionString: restricted.databaseUrl });
    restrictedPools.push(restrictedPool);

    const visible = await withContext(
      restrictedPool,
      fixture.tenantId,
      fixture.actorId,
      async (client) => ({
        runs: await selectedIds(client, "workflow_runs", [
          fixture.prefixRun,
          fixture.triggerRun,
          fixture.reservedSnapshotRun,
          fixture.malformedSnapshotRun,
          fixture.genericRun,
        ]),
        steps: await selectedIds(client, "workflow_run_steps", [
          fixture.conversationStep,
          fixture.genericStep,
        ]),
        events: await selectedIds(client, "domain_events", [
          fixture.planEvent,
          fixture.resumeEvent,
          fixture.genericEvent,
        ]),
      }),
    );
    expect(visible).toEqual({
      runs: [
        fixture.genericRun,
        fixture.malformedSnapshotRun,
        fixture.prefixRun,
        fixture.reservedSnapshotRun,
        fixture.triggerRun,
      ].sort(),
      steps: [fixture.conversationStep, fixture.genericStep].sort(),
      events: [
        fixture.genericEvent,
        fixture.planEvent,
        fixture.resumeEvent,
      ].sort(),
    });

    for (const candidate of [
      {
        id: `run_insert_prefix_${fixture.unique}`,
        key: `conversation_plan:${fixture.planId}`,
        trigger: "generic.event",
        snapshot: workflowSnapshot({
          key: `conversation_plan:${fixture.planId}`,
          trigger: "generic.event",
          actionType: "create_task",
        }),
      },
      {
        id: `run_insert_trigger_${fixture.unique}`,
        key: `generic.trigger.${fixture.unique}`,
        trigger: "conversation.plan.execute",
        snapshot: workflowSnapshot({
          key: `generic.trigger.${fixture.unique}`,
          trigger: "conversation.plan.execute",
          actionType: "create_task",
        }),
      },
      {
        id: `run_insert_reserved_${fixture.unique}`,
        key: `generic.reserved.${fixture.unique}`,
        trigger: "generic.event",
        snapshot: workflowSnapshot({
          key: `generic.reserved.${fixture.unique}`,
          trigger: "generic.event",
          actionType: "mock_search_contact",
        }),
      },
      {
        id: `run_insert_malformed_${fixture.unique}`,
        key: `generic.malformed.${fixture.unique}`,
        trigger: "generic.event",
        snapshot: "{x",
      },
    ]) {
      await expectDenied(() =>
        withContext(
          restrictedPool,
          fixture.tenantId,
          fixture.actorId,
          (client) =>
            insertRun(client, {
              tenantId: fixture.tenantId,
              ...candidate,
            }),
        ),
      );
    }

    await expectDenied(() =>
      withContext(
        restrictedPool,
        fixture.tenantId,
        fixture.actorId,
        (client) =>
          insertStep(client, {
            id: `step_reserved_${fixture.unique}`,
            tenantId: fixture.tenantId,
            runId: fixture.genericRun,
            actionName: "mock_create_task",
          }),
      ),
    );
    await expectDenied(() =>
      withContext(
        restrictedPool,
        fixture.tenantId,
        fixture.actorId,
        (client) =>
          insertStep(client, {
            id: `step_parent_${fixture.unique}`,
            tenantId: fixture.tenantId,
            runId: fixture.prefixRun,
            actionName: "create_task",
          }),
      ),
    );

    for (const event of [
      {
        id: `event_plan_insert_${fixture.unique}`,
        type: "conversation.plan.execute",
        payload: { planId: fixture.planId },
      },
      {
        id: `event_resume_insert_${fixture.unique}`,
        type: "workflow.resume",
        payload: { runId: fixture.prefixRun },
      },
      {
        id: `event_resume_malformed_${fixture.unique}`,
        type: "workflow.resume",
        payload: {},
      },
      {
        id: `event_resume_absent_${fixture.unique}`,
        type: "workflow.resume",
        payload: { runId: `run_absent_${fixture.unique}` },
      },
    ]) {
      await expectDenied(() =>
        withContext(
          restrictedPool,
          fixture.tenantId,
          fixture.actorId,
          (client) =>
            insertEvent(client, {
              tenantId: fixture.tenantId,
              actorId: fixture.actorId,
              ...event,
            }),
        ),
      );
    }

    await expectDenied(() =>
      withContext(
        restrictedPool,
        fixture.tenantId,
        fixture.actorId,
        (client) =>
          client.query(
            `insert into conversation_action_plans (
               id, tenant_id, thread_id, source_message_id, schema_version,
               generation_source, approval_status, intent, business_goal,
               confidence, risk_summary, estimated_cost_minor,
               estimated_cost_currency, plan_json, plan_fingerprint,
               created_by, created_at, updated_at
             ) select $1, tenant_id, thread_id, source_message_id,
               schema_version, generation_source, approval_status, intent,
               business_goal, confidence, risk_summary, estimated_cost_minor,
               estimated_cost_currency, plan_json, $2, created_by, created_at,
               updated_at
             from conversation_action_plans where id = $3`,
            [
              `plan_direct_${fixture.unique}`,
              "b".repeat(64),
              fixture.planId,
            ],
          ),
      ),
    );
    await expectDenied(() =>
      withContext(
        restrictedPool,
        fixture.tenantId,
        fixture.actorId,
        (client) =>
          client.query(
            `insert into conversation_action_plan_steps (
               tenant_id, plan_id, position, step_id, capability, mode,
               execution_environment, risk, requires_approval, reversible,
               input_json, evidence_required_json, idempotency_key, status
             ) values (
               $1, $2, 1, $3, 'project.task.create', 'write', 'mock',
               'medium', 1, 'true', '{}', '[]', $4, 'planned'
             )`,
            [
              fixture.tenantId,
              fixture.planId,
              `forged_step_${fixture.unique}`,
              `forged:step:${fixture.unique}`,
            ],
          ),
      ),
    );
    await expectDenied(() =>
      withContext(
        restrictedPool,
        fixture.tenantId,
        fixture.actorId,
        (client) =>
          client.query(
            `insert into approvals (
               id, tenant_id, requested_by, policy, status, target_type,
               target_id, created_at
             ) values (
               $1, $2, $3, 'single', 'approved',
               'conversation_action_plan', $4, $5
             )`,
            [
              `approval_direct_${fixture.unique}`,
              fixture.tenantId,
              fixture.actorId,
              fixture.planId,
              timestamp,
            ],
          ),
      ),
    );

    await expectDenied(() =>
      withContext(
        restrictedPool,
        fixture.tenantId,
        fixture.actorId,
        (client) =>
          client.query(
            `update workflow_runs
             set trigger_name = 'conversation.plan.execute'
             where id = $1`,
            [fixture.genericRun],
          ),
      ),
    );
    await expectDenied(() =>
      withContext(
        restrictedPool,
        fixture.tenantId,
        fixture.actorId,
        (client) =>
          client.query(
            `update workflow_run_steps
             set action_name = 'mock_search_contact'
             where id = $1`,
            [fixture.genericStep],
          ),
      ),
    );
    await expectDenied(() =>
      withContext(
        restrictedPool,
        fixture.tenantId,
        fixture.actorId,
        (client) =>
          client.query(
            `update domain_events
             set event_type = 'conversation.plan.execute', payload = $1
             where id = $2`,
            [JSON.stringify({ planId: fixture.planId }), fixture.genericEvent],
          ),
      ),
    );

    const protectedMutations = await withContext(
      restrictedPool,
      fixture.tenantId,
      fixture.actorId,
      async (client) => ({
        planUpdate: (
          await client.query(
            `update conversation_action_plans set approval_status = 'rejected'
             where id = $1 returning id`,
            [fixture.planId],
          )
        ).rows,
        planDelete: (
          await client.query(
            "delete from conversation_action_plans where id = $1 returning id",
            [fixture.planId],
          )
        ).rows,
        planStepUpdate: (
          await client.query(
            `update conversation_action_plan_steps set status = 'cancelled'
             where tenant_id = $1 and plan_id = $2 and position = 0
             returning step_id as id`,
            [fixture.tenantId, fixture.planId],
          )
        ).rows,
        planStepDelete: (
          await client.query(
            `delete from conversation_action_plan_steps
             where tenant_id = $1 and plan_id = $2 and position = 0
             returning step_id as id`,
            [fixture.tenantId, fixture.planId],
          )
        ).rows,
        approvalUpdate: (
          await client.query(
            `update approvals set status = 'rejected'
             where id = $1 returning id`,
            [fixture.approvalId],
          )
        ).rows,
        approvalDelete: (
          await client.query(
            "delete from approvals where id = $1 returning id",
            [fixture.approvalId],
          )
        ).rows,
        runUpdate: (
          await client.query(
            `update workflow_runs set trigger_name = 'generic.event'
             where id = $1 returning id`,
            [fixture.triggerRun],
          )
        ).rows,
        runDelete: (
          await client.query(
            "delete from workflow_runs where id = $1 returning id",
            [fixture.prefixRun],
          )
        ).rows,
        stepUpdate: (
          await client.query(
            `update workflow_run_steps set action_name = 'create_task'
             where id = $1 returning id`,
            [fixture.conversationStep],
          )
        ).rows,
        stepDelete: (
          await client.query(
            "delete from workflow_run_steps where id = $1 returning id",
            [fixture.conversationStep],
          )
        ).rows,
        eventUpdate: (
          await client.query(
            `update domain_events set event_type = 'generic.event', payload = '{}'
             where id = $1 returning id`,
            [fixture.planEvent],
          )
        ).rows,
        eventDelete: (
          await client.query(
            "delete from domain_events where id = $1 returning id",
            [fixture.resumeEvent],
          )
        ).rows,
      }),
    );
    expect(protectedMutations).toEqual({
      planUpdate: [],
      planDelete: [],
      planStepUpdate: [],
      planStepDelete: [],
      approvalUpdate: [],
      approvalDelete: [],
      runUpdate: [],
      runDelete: [],
      stepUpdate: [],
      stepDelete: [],
      eventUpdate: [],
      eventDelete: [],
    });

    const genericIds = {
      run: `run_generic_crud_${fixture.unique}`,
      step: `step_generic_crud_${fixture.unique}`,
      event: `event_generic_crud_${fixture.unique}`,
      resume: `event_generic_resume_${fixture.unique}`,
      approval: `approval_generic_crud_${fixture.unique}`,
    };
    const genericCrud = await withContext(
      restrictedPool,
      fixture.tenantId,
      fixture.actorId,
      async (client) => {
        await insertRun(client, {
          id: genericIds.run,
          tenantId: fixture.tenantId,
          key: `generic.crud.${fixture.unique}`,
          trigger: "lead.created",
          snapshot: workflowSnapshot({
            key: `generic.crud.${fixture.unique}`,
            trigger: "lead.created",
            actionType: "create_task",
          }),
        });
        await insertStep(client, {
          id: genericIds.step,
          tenantId: fixture.tenantId,
          runId: genericIds.run,
          actionName: "create_task",
        });
        await insertEvent(client, {
          id: genericIds.event,
          tenantId: fixture.tenantId,
          actorId: fixture.actorId,
          type: "lead.created",
          payload: { leadId: `lead_${fixture.unique}` },
        });
        await insertEvent(client, {
          id: genericIds.resume,
          tenantId: fixture.tenantId,
          actorId: fixture.actorId,
          type: "workflow.resume",
          payload: { runId: genericIds.run },
        });
        await client.query(
          `insert into approvals (
             id, tenant_id, requested_by, policy, status, target_type,
             target_id, created_at
           ) values (
             $1, $2, $3, 'single', 'pending', 'generic_workflow', $4, $5
           )`,
          [
            genericIds.approval,
            fixture.tenantId,
            fixture.actorId,
            genericIds.run,
            timestamp,
          ],
        );
        const updatedRun = await client.query(
          `update workflow_runs set status = 'waiting'
           where id = $1 returning id`,
          [genericIds.run],
        );
        const updatedStep = await client.query(
          `update workflow_run_steps set status = 'succeeded'
           where id = $1 returning id`,
          [genericIds.step],
        );
        const updatedEvent = await client.query(
          `update domain_events set status = 'processing'
           where id = $1 returning id`,
          [genericIds.event],
        );
        const updatedApproval = await client.query(
          `update approvals set status = 'approved'
           where id = $1 returning id`,
          [genericIds.approval],
        );
        const deletedSteps = await client.query(
          "delete from workflow_run_steps where id = $1 returning id",
          [genericIds.step],
        );
        const deletedEvents = await client.query(
          "delete from domain_events where id in ($1, $2) returning id",
          [genericIds.event, genericIds.resume],
        );
        const deletedRuns = await client.query(
          "delete from workflow_runs where id = $1 returning id",
          [genericIds.run],
        );
        const deletedApprovals = await client.query(
          "delete from approvals where id = $1 returning id",
          [genericIds.approval],
        );
        return {
          run: updatedRun.rows,
          step: updatedStep.rows,
          event: updatedEvent.rows,
          approval: updatedApproval.rows,
          deletedRuns: deletedRuns.rows,
          deletedSteps: deletedSteps.rows,
          deletedEvents: deletedEvents.rows.sort((left, right) =>
            String(left.id).localeCompare(String(right.id)),
          ),
          deletedApprovals: deletedApprovals.rows,
        };
      },
    );
    expect(genericCrud).toEqual({
      run: [{ id: genericIds.run }],
      step: [{ id: genericIds.step }],
      event: [{ id: genericIds.event }],
      approval: [{ id: genericIds.approval }],
      deletedRuns: [{ id: genericIds.run }],
      deletedSteps: [{ id: genericIds.step }],
      deletedEvents: [
        { id: genericIds.event },
        { id: genericIds.resume },
      ].sort((left, right) => left.id.localeCompare(right.id)),
      deletedApprovals: [{ id: genericIds.approval }],
    });

    const systemIds = {
      run: `run_system_${fixture.unique}`,
      step: `step_system_${fixture.unique}`,
      event: `event_system_${fixture.unique}`,
    };
    await withContext(
      ownerPool,
      fixture.tenantId,
      fixture.actorId,
      async (client) => {
        await client.query("select set_config('app.system_access', 'true', true)");
        await insertRun(client, {
          id: systemIds.run,
          tenantId: fixture.tenantId,
          key: `conversation_plan:${fixture.planId}`,
          trigger: "conversation.plan.execute",
          snapshot: workflowSnapshot({
            key: `conversation_plan:${fixture.planId}`,
            trigger: "conversation.plan.execute",
            actionType: "mock_create_task",
          }),
        });
        await insertStep(client, {
          id: systemIds.step,
          tenantId: fixture.tenantId,
          runId: systemIds.run,
          actionName: "mock_create_task",
        });
        await insertEvent(client, {
          id: systemIds.event,
          tenantId: fixture.tenantId,
          actorId: fixture.actorId,
          type: "workflow.resume",
          payload: { runId: systemIds.run },
        });
      },
    );
    const systemRows = await ownerPool.query<{ id: string }>(
      `select id from workflow_runs where id = $1
       union all select id from workflow_run_steps where id = $2
       union all select id from domain_events where id = $3
       order by id`,
      [systemIds.run, systemIds.step, systemIds.event],
    );
    expect(systemRows.rows.map((row) => row.id)).toEqual(
      Object.values(systemIds).sort(),
    );

    await expect(
      withContext(
        restrictedPool,
        fixture.tenantId,
        fixture.actorId,
        (client) =>
          client.query(
            "delete from conversation_threads where id = $1",
            [fixture.threadId],
          ),
      ),
    ).rejects.toThrow(/conversation_action_plan_delete_forbidden/i);
    const protectedRows = await ownerPool.query(
      `select
         (select count(*)::int from conversation_threads where id = $1)
           as thread_count,
         (select count(*)::int from conversation_action_plans where id = $2)
           as plan_count`,
      [fixture.threadId, fixture.planId],
    );
    expect(protectedRows.rows).toEqual([{ thread_count: 1, plan_count: 1 }]);

    await ownerPool.query("delete from tenants where id = $1", [fixture.tenantId]);
    const cascadedRows = await ownerPool.query(
      `select
         (select count(*)::int from conversation_threads where id = $1)
           as thread_count,
         (select count(*)::int from conversation_action_plans where id = $2)
           as plan_count`,
      [fixture.threadId, fixture.planId],
    );
    expect(cascadedRows.rows).toEqual([{ thread_count: 0, plan_count: 0 }]);
  });
});

async function seedFixture(ownerPool: Pool, unique: string) {
  const tenantId = `tenant_workflow_write_rls_${unique}`;
  const actorId = `user_workflow_write_rls_${unique}`;
  const participantId = `participant_workflow_write_rls_${unique}`;
  const identityId = `identity_workflow_write_rls_${unique}`;
  const threadId = `thread_workflow_write_rls_${unique}`;
  const messageId = `message_workflow_write_rls_${unique}`;
  const planId = `plan_workflow_write_rls_${unique}`;
  const approvalId = `approval_workflow_write_rls_${unique}`;
  const prefixRun = `run_prefix_${unique}`;
  const triggerRun = `run_trigger_${unique}`;
  const reservedSnapshotRun = `run_reserved_snapshot_${unique}`;
  const malformedSnapshotRun = `run_malformed_snapshot_${unique}`;
  const genericRun = `run_generic_${unique}`;
  const conversationStep = `step_conversation_${unique}`;
  const genericStep = `step_generic_${unique}`;
  const planEvent = `event_plan_${unique}`;
  const resumeEvent = `event_resume_${unique}`;
  const genericEvent = `event_generic_${unique}`;

  await ownerPool.query(
    `insert into users (id, name, email, password_hash, created_at)
     values ($1, 'Collaborateur RLS', $1 || '@example.test', 'hash', $2)`,
    [actorId, timestamp],
  );
  await ownerPool.query(
    `insert into tenants (id, name, slug, category, created_at)
     values ($1, 'Organisation RLS workflow', $1, 'Services', $2)`,
    [tenantId, timestamp],
  );
  await ownerPool.query(
    `insert into memberships (tenant_id, user_id, role, created_at)
     values ($1, $2, 'collaborator', $3)`,
    [tenantId, actorId, timestamp],
  );
  await ownerPool.query(
    `insert into conversation_participants (
       id, tenant_id, role, display_name, created_at, updated_at
     ) values ($1, $2, 'member', 'Collaborateur', $3, $3)`,
    [participantId, tenantId, timestamp],
  );
  await ownerPool.query(
    `insert into conversation_channel_identities (
       id, tenant_id, participant_id, channel_kind, adapter_key,
       external_subject_id, display_name, role, state, created_at, updated_at
     ) values (
       $1, $2, $3, 'web', 'web-chat', $4, 'Collaborateur', 'member', 'active',
       $5, $5
     )`,
    [identityId, tenantId, participantId, actorId, timestamp],
  );
  await ownerPool.query(
    `insert into conversation_threads (
       id, tenant_id, status, subject, confidentiality_level, visibility_scope,
       created_at, updated_at
     ) values (
       $1, $2, 'open', 'Workflow protégé', 'internal', 'tenant', $3, $3
     )`,
    [threadId, tenantId, timestamp],
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
      tenantId,
      threadId,
      identityId,
      `external_${unique}`,
      `ingress:${unique}`,
      `correlation:${unique}`,
      timestamp,
    ],
  );
  await ownerPool.query(
    `insert into conversation_action_plans (
       id, tenant_id, thread_id, source_message_id, schema_version,
       generation_source, approval_status, intent, business_goal, confidence,
       risk_summary, estimated_cost_minor, estimated_cost_currency, plan_json,
       plan_fingerprint, created_by, created_at, updated_at
     ) values (
       $1, $2, $3, $4, 1, 'deterministic_mock', 'awaiting_approval', 'Tester',
       'Protéger les preuves', 1, 'Risque borné', 0, 'EUR', '{}', $5, $6, $7, $7
     )`,
    [planId, tenantId, threadId, messageId, "a".repeat(64), actorId, timestamp],
  );
  await ownerPool.query(
    `insert into conversation_action_plan_steps (
       tenant_id, plan_id, position, step_id, capability, mode,
       execution_environment, risk, requires_approval, reversible, input_json,
       evidence_required_json, idempotency_key, status
     ) values (
       $1, $2, 0, $3, 'crm.contacts.search', 'read', 'mock', 'low', 0,
       'true', '{}', '[]', $4, 'planned'
     )`,
    [tenantId, planId, `plan_step_${unique}`, `plan:step:${unique}`],
  );
  await ownerPool.query(
    `insert into approvals (
       id, tenant_id, requested_by, policy, status, target_type, target_id,
       created_at
     ) values (
       $1, $2, $3, 'single', 'pending', 'conversation_action_plan', $4, $5
     )`,
    [approvalId, tenantId, actorId, planId, timestamp],
  );

  for (const run of [
    {
      id: prefixRun,
      key: `conversation_plan:${planId}`,
      trigger: "generic.event",
      snapshot: workflowSnapshot({
        key: `conversation_plan:${planId}`,
        trigger: "generic.event",
        actionType: "create_task",
      }),
    },
    {
      id: triggerRun,
      key: `generic.trigger.${unique}`,
      trigger: "conversation.plan.execute",
      snapshot: workflowSnapshot({
        key: `generic.trigger.${unique}`,
        trigger: "conversation.plan.execute",
        actionType: "create_task",
      }),
    },
    {
      id: reservedSnapshotRun,
      key: `generic.reserved.${unique}`,
      trigger: "generic.event",
      snapshot: workflowSnapshot({
        key: `generic.reserved.${unique}`,
        trigger: "generic.event",
        actionType: "mock_search_contact",
      }),
    },
    {
      id: malformedSnapshotRun,
      key: `generic.malformed.${unique}`,
      trigger: "generic.event",
      snapshot: "{x",
    },
    {
      id: genericRun,
      key: `generic.workflow.${unique}`,
      trigger: "lead.created",
      snapshot: workflowSnapshot({
        key: `generic.workflow.${unique}`,
        trigger: "lead.created",
        actionType: "create_task",
      }),
    },
  ]) {
    await insertRun(ownerPool, { tenantId, ...run });
  }
  await insertStep(ownerPool, {
    id: conversationStep,
    tenantId,
    runId: prefixRun,
    actionName: "mock_search_contact",
  });
  await insertStep(ownerPool, {
    id: genericStep,
    tenantId,
    runId: genericRun,
    actionName: "create_task",
  });
  await insertEvent(ownerPool, {
    id: planEvent,
    tenantId,
    actorId,
    type: "conversation.plan.execute",
    payload: { planId },
  });
  await insertEvent(ownerPool, {
    id: resumeEvent,
    tenantId,
    actorId,
    type: "workflow.resume",
    payload: { runId: prefixRun },
  });
  await insertEvent(ownerPool, {
    id: genericEvent,
    tenantId,
    actorId,
    type: "lead.created",
    payload: { leadId: `lead_${unique}` },
  });

  return {
    unique,
    tenantId,
    actorId,
    threadId,
    planId,
    approvalId,
    prefixRun,
    triggerRun,
    reservedSnapshotRun,
    malformedSnapshotRun,
    genericRun,
    conversationStep,
    genericStep,
    planEvent,
    resumeEvent,
    genericEvent,
  };
}

function workflowSnapshot(input: {
  key: string;
  trigger: string;
  actionType: string;
}) {
  return JSON.stringify({
    key: input.key,
    version: 1,
    trigger: input.trigger,
    active: true,
    conditions: [],
    actions: [{ type: input.actionType, input: {} }],
    retryPolicy: { maxAttempts: 3, backoffMs: 0 },
    timeoutMs: 30_000,
    approvalPolicy: "no_approval_required",
  });
}

async function insertRun(
  client: Pick<Pool, "query"> | PoolClient,
  input: {
    id: string;
    tenantId: string;
    key: string;
    trigger: string;
    snapshot: string;
  },
) {
  return client.query(
    `insert into workflow_runs (
       id, tenant_id, workflow_key, trigger_name, status, summary, error,
       retry_count, definition_snapshot, definition_version, created_at
     ) values ($1, $2, $3, $4, 'running', 'Test RLS', null, 0, $5, 1, $6)`,
    [
      input.id,
      input.tenantId,
      input.key,
      input.trigger,
      input.snapshot,
      timestamp,
    ],
  );
}

async function insertStep(
  client: Pick<Pool, "query"> | PoolClient,
  input: {
    id: string;
    tenantId: string;
    runId: string;
    actionName: string;
  },
) {
  return client.query(
    `insert into workflow_run_steps (
       id, tenant_id, workflow_run_id, action_name, status, safe_metadata,
       attempts, scheduled_at, started_at, completed_at, error, created_at
     ) values (
       $1, $2, $3, $4, 'running', '{}', 1, $5, $5, null, null, $5
     )`,
    [input.id, input.tenantId, input.runId, input.actionName, timestamp],
  );
}

async function insertEvent(
  client: Pick<Pool, "query"> | PoolClient,
  input: {
    id: string;
    tenantId: string;
    actorId: string;
    type: string;
    payload: Record<string, unknown>;
  },
) {
  return client.query(
    `insert into domain_events (
       id, tenant_id, actor_id, event_type, payload, status, attempts,
       idempotency_key, correlation_id, causation_id, next_run_at, last_error,
       created_at, updated_at
     ) values (
       $1, $2, $3, $4, $5, 'pending', 0, $6, $7, null, $8, null, $8, $8
     )`,
    [
      input.id,
      input.tenantId,
      input.actorId,
      input.type,
      JSON.stringify(input.payload),
      `idempotency:${input.id}`,
      `correlation:${input.id}`,
      timestamp,
    ],
  );
}

async function selectedIds(client: PoolClient, table: string, ids: string[]) {
  const result = await client.query<{ id: string }>(
    `select id from ${quoteIdentifier(table)}
     where id = any($1::text[]) order by id`,
    [ids],
  );
  return result.rows.map((row) => row.id);
}

async function expectDenied(operation: () => Promise<unknown>) {
  await expect(operation()).rejects.toThrow(/row-level security|violates/i);
}

async function createRestrictedRole(ownerPool: Pool) {
  if (!databaseUrl) throw new Error("DATABASE_URL est requis.");
  const roleName = `tradikom_workflow_write_${randomUUID().replaceAll("-", "")}`;
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
