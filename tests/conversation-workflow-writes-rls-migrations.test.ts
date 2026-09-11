import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb, getMigrationIds } from "../src/lib/db";

const opened: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("migration RLS des écritures workflow Conversation", () => {
  it("garde la migration runtime et son miroir SQL identiques", () => {
    const runtime = readFileSync(
      new URL("../src/lib/db.ts", import.meta.url),
      "utf8",
    );
    const mirror = readFileSync(
      new URL(
        "../src/db/migrations/0112_os5_conversation_workflow_writes_rls.sql",
        import.meta.url,
      ),
      "utf8",
    );

    expect(
      extractSqlTemplate(
        runtime,
        "os5ConversationWorkflowWritesRlsMigrationSql",
      ).trim(),
    ).toBe(mirror.trim());
    expect(getMigrationIds()).not.toContain(
      "118_os5_conversation_workflow_writes_rls",
    );
    expect(getMigrationIds(true).at(-1)).toBe(
      "118_os5_conversation_workflow_writes_rls",
    );
  });

  it("ajoute dix-huit gardes RESTRICTIVE sans masquer les lectures", () => {
    const migration = readFileSync(
      new URL(
        "../src/db/migrations/0112_os5_conversation_workflow_writes_rls.sql",
        import.meta.url,
      ),
      "utf8",
    );

    expect(migration.match(/as restrictive/gi)).toHaveLength(18);
    expect(migration.match(/security invoker/gi)).toHaveLength(4);
    expect(migration).not.toMatch(/security\s+definer/i);
    expect(migration).not.toMatch(/for\s+select/i);
    for (const table of [
      "workflow_runs",
      "workflow_run_steps",
      "domain_events",
      "conversation_action_plans",
      "conversation_action_plan_steps",
      "approvals",
    ]) {
      expect(migration.match(new RegExp(`on ${table}`, "g"))).toHaveLength(
        table === "conversation_action_plans" ? 8 : 6,
      );
    }
    expect(migration.match(/for insert to public/gi)).toHaveLength(6);
    expect(migration.match(/for update to public/gi)).toHaveLength(6);
    expect(migration.match(/for delete to public/gi)).toHaveLength(6);
    expect(migration.match(/with check/gi)).toHaveLength(12);
    expect(migration.match(/using \(/gi)).toHaveLength(12);
  });

  it("classe tous les marqueurs Conversation et ferme les entrées ambiguës", () => {
    const migration = readFileSync(
      new URL(
        "../src/db/migrations/0112_os5_conversation_workflow_writes_rls.sql",
        import.meta.url,
      ),
      "utf8",
    );

    expect(migration).toContain("like 'conversation_plan:%'");
    expect(migration).toContain("'conversation.plan.execute'");
    expect(migration).toContain("'mock_search_contact'");
    expect(migration).toContain("'mock_create_task'");
    expect(migration).toContain("return true;");
    expect(migration).toContain("target_event_type = 'workflow.resume'");
    expect(migration).toContain("app_is_system()");
    expect(migration).toContain("conversation_action_plans_delete_guard");
    expect(migration).toContain("conversation_action_plan_delete_forbidden");
  });

  it("applique le miroir sur PGlite et classe les preuves sans exception", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const applied = await db.query<{ id: string }>(
      `select id from schema_migrations
       where id = '118_os5_conversation_workflow_writes_rls'`,
    );

    expect(applied.rows).toEqual([]);

    const migration = readFileSync(
      new URL(
        "../src/db/migrations/0112_os5_conversation_workflow_writes_rls.sql",
        import.meta.url,
      ),
      "utf8",
    );
    await db.exec(`
      create or replace function app_is_system()
      returns boolean language sql stable as $$ select false $$;
    `);
    await db.exec(migration);

    const tenantId = "tenant_conversation_workflow_classifier";
    const protectedRunId = "run_conversation_workflow_classifier";
    const genericRunId = "run_generic_workflow_classifier";
    const genericSnapshot = workflowSnapshot({
      key: "generic.workflow",
      trigger: "lead.created",
      actionType: "create_task",
    });
    await db.query(
      `insert into tenants (id, name, slug, category, created_at)
       values ($1, 'Organisation classificateur', $1, 'Services', $2)`,
      [tenantId, "2026-09-11T05:00:00.000Z"],
    );
    for (const run of [
      {
        id: protectedRunId,
        key: "conversation_plan:plan_classifier",
        trigger: "conversation.plan.execute",
      },
      {
        id: genericRunId,
        key: "generic.workflow",
        trigger: "lead.created",
      },
    ]) {
      await db.query(
        `insert into workflow_runs (
           id, tenant_id, workflow_key, trigger_name, status, summary, error,
           retry_count, definition_snapshot, definition_version, created_at
         ) values ($1, $2, $3, $4, 'running', 'Test', null, 0, $5, 1, $6)`,
        [
          run.id,
          tenantId,
          run.key,
          run.trigger,
          genericSnapshot,
          "2026-09-11T05:00:00.000Z",
        ],
      );
    }

    const reservedSnapshot = workflowSnapshot({
      key: "generic.workflow",
      trigger: "lead.created",
      actionType: "mock_search_contact",
    });
    const snapshotConversationKey = workflowSnapshot({
      key: "conversation_plan:plan_snapshot",
      trigger: "lead.created",
      actionType: "create_task",
    });
    const snapshotConversationTrigger = workflowSnapshot({
      key: "generic.workflow",
      trigger: "conversation.plan.execute",
      actionType: "create_task",
    });
    const classifications = await db.query<{
      prefix_column: boolean;
      trigger_column: boolean;
      reserved_action: boolean;
      snapshot_key: boolean;
      snapshot_trigger: boolean;
      invalid_json: boolean;
      empty_object: boolean;
      empty_actions: boolean;
      invalid_action: boolean;
      generic_valid: boolean;
      generic_legacy: boolean;
      plan_event: boolean;
      protected_resume: boolean;
      generic_resume: boolean;
      absent_resume: boolean;
      missing_resume: boolean;
      invalid_resume: boolean;
    }>(
      `select
         app_is_conversation_policy_workflow(
           'conversation_plan:plan', 'lead.created', $1
         ) as prefix_column,
         app_is_conversation_policy_workflow(
           'generic.workflow', 'conversation.plan.execute', $1
         ) as trigger_column,
         app_is_conversation_policy_workflow(
           'generic.workflow', 'lead.created', $2
         ) as reserved_action,
         app_is_conversation_policy_workflow(
           'generic.workflow', 'lead.created', $3
         ) as snapshot_key,
         app_is_conversation_policy_workflow(
           'generic.workflow', 'lead.created', $4
         ) as snapshot_trigger,
         app_is_conversation_policy_workflow(
           'generic.workflow', 'lead.created', '{x'
         ) as invalid_json,
         app_is_conversation_policy_workflow(
           'generic.workflow', 'lead.created', '{}'
         ) as empty_object,
         app_is_conversation_policy_workflow(
           'generic.workflow', 'lead.created',
           '{"key":"generic.workflow","version":1,"trigger":"lead.created","active":true,"actions":[],"retryPolicy":{"maxAttempts":3,"backoffMs":0},"timeoutMs":30000,"approvalPolicy":"no_approval_required"}'
         ) as empty_actions,
         app_is_conversation_policy_workflow(
           'generic.workflow', 'lead.created',
           '{"key":"generic.workflow","version":1,"trigger":"lead.created","active":true,"actions":[{}],"retryPolicy":{"maxAttempts":3,"backoffMs":0},"timeoutMs":30000,"approvalPolicy":"no_approval_required"}'
         ) as invalid_action,
         app_is_conversation_policy_workflow(
           'generic.workflow', 'lead.created', $1
         ) as generic_valid,
         app_is_conversation_policy_workflow(
           'generic.legacy', 'lead.created', null
         ) as generic_legacy,
         app_is_conversation_policy_event(
           $5, 'conversation.plan.execute', '{}'
         ) as plan_event,
         app_is_conversation_policy_event(
           $5, 'workflow.resume', $6
         ) as protected_resume,
         app_is_conversation_policy_event(
           $5, 'workflow.resume', $7
         ) as generic_resume,
         app_is_conversation_policy_event(
           $5, 'workflow.resume', '{"runId":"run_absent"}'
         ) as absent_resume,
         app_is_conversation_policy_event(
           $5, 'workflow.resume', '{}'
         ) as missing_resume,
         app_is_conversation_policy_event(
           $5, 'workflow.resume', '{x'
         ) as invalid_resume`,
      [
        genericSnapshot,
        reservedSnapshot,
        snapshotConversationKey,
        snapshotConversationTrigger,
        tenantId,
        JSON.stringify({ runId: protectedRunId }),
        JSON.stringify({ runId: genericRunId }),
      ],
    );

    expect(classifications.rows[0]).toEqual({
      prefix_column: true,
      trigger_column: true,
      reserved_action: true,
      snapshot_key: true,
      snapshot_trigger: true,
      invalid_json: true,
      empty_object: true,
      empty_actions: true,
      invalid_action: true,
      generic_valid: false,
      generic_legacy: false,
      plan_event: true,
      protected_resume: true,
      generic_resume: false,
      absent_resume: true,
      missing_resume: true,
      invalid_resume: true,
    });

    const policies = await db.query<{
      policyname: string;
      permissive: string;
      cmd: string;
    }>(
      `select policyname, permissive, cmd
       from pg_policies
       where policyname like '%_conversation_write_%'
       order by policyname`,
    );
    expect(policies.rows).toHaveLength(18);
    expect(new Set(policies.rows.map((row) => row.permissive))).toEqual(
      new Set(["RESTRICTIVE"]),
    );
    expect(new Set(policies.rows.map((row) => row.cmd))).toEqual(
      new Set(["INSERT", "UPDATE", "DELETE"]),
    );

    const actorId = "user_conversation_plan_delete_guard";
    const participantId = "participant_conversation_plan_delete_guard";
    const identityId = "identity_conversation_plan_delete_guard";
    const threadId = "thread_conversation_plan_delete_guard";
    const messageId = "message_conversation_plan_delete_guard";
    const planId = "plan_conversation_plan_delete_guard";
    const createdAt = "2026-09-11T05:00:00.000Z";
    await db.query(
      `insert into users (id, name, email, password_hash, created_at)
       values ($1, 'Acteur garde', $2, 'hash', $3)`,
      [actorId, `${actorId}@example.test`, createdAt],
    );
    await db.query(
      `insert into conversation_participants (
         id, tenant_id, role, display_name, created_at, updated_at
       ) values ($1, $2, 'member', 'Acteur garde', $3, $3)`,
      [participantId, tenantId, createdAt],
    );
    await db.query(
      `insert into conversation_channel_identities (
         id, tenant_id, participant_id, channel_kind, adapter_key,
         external_subject_id, display_name, role, state, created_at, updated_at
       ) values (
         $1, $2, $3, 'test', 'test-adapter', $4, 'Acteur garde', 'member',
         'active', $5, $5
       )`,
      [identityId, tenantId, participantId, actorId, createdAt],
    );
    await db.query(
      `insert into conversation_threads (
         id, tenant_id, status, subject, created_at, updated_at
       ) values ($1, $2, 'open', 'Garde cascade', $3, $3)`,
      [threadId, tenantId, createdAt],
    );
    await db.query(
      `insert into conversation_messages (
         id, tenant_id, thread_id, channel_identity_id, direction, kind,
         status, text_content, adapter_key, external_message_id,
         idempotency_key, correlation_id, occurred_at, created_at
       ) values (
         $1, $2, $3, $4, 'inbound', 'text', 'received', 'Préparer',
         'test-adapter', $5, $6, $7, $8, $8
       )`,
      [
        messageId,
        tenantId,
        threadId,
        identityId,
        `external:${messageId}`,
        `ingress:${messageId}`,
        `correlation:${messageId}`,
        createdAt,
      ],
    );
    await db.query(
      `insert into conversation_action_plans (
         id, tenant_id, thread_id, source_message_id, schema_version,
         generation_source, approval_status, intent, business_goal,
         confidence, risk_summary, estimated_cost_minor,
         estimated_cost_currency, plan_json, plan_fingerprint, created_by,
         created_at, updated_at
       ) values (
         $1, $2, $3, $4, 1, 'deterministic_mock', 'awaiting_approval',
         'Tester', 'Bloquer la cascade', 1, 'Risque borné', 0, 'EUR', '{}',
         $5, $6, $7, $7
       )`,
      [planId, tenantId, threadId, messageId, "a".repeat(64), actorId, createdAt],
    );

    await expect(
      db.query("delete from conversation_threads where id = $1", [threadId]),
    ).rejects.toThrow(/conversation_action_plan_delete_forbidden/i);
    expect(
      (
        await db.query<{ id: string }>(
          "select id from conversation_action_plans where id = $1",
          [planId],
        )
      ).rows,
    ).toEqual([{ id: planId }]);

    await db.query("delete from tenants where id = $1", [tenantId]);
    expect(
      (
        await db.query<{ id: string }>(
          "select id from conversation_action_plans where id = $1",
          [planId],
        )
      ).rows,
    ).toEqual([]);
  });
});

function extractSqlTemplate(source: string, constant: string) {
  const prefix = `const ${constant} = \``;
  const start = source.indexOf(prefix);
  if (start < 0) throw new Error(`Migration runtime absente : ${constant}.`);
  const sqlStart = start + prefix.length;
  const sqlEnd = source.indexOf("`;", sqlStart);
  if (sqlEnd < 0) throw new Error(`Migration runtime invalide : ${constant}.`);
  return source.slice(sqlStart, sqlEnd);
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
