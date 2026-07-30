import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb, getMigrationIds } from "../src/lib/db";

const opened: Array<{ close: () => Promise<void> }> = [];
const timestamp = "2026-07-30T14:00:00.000Z";

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("migrations des plans Conversation", () => {
  it("ajoute les plans immuables et leurs étapes tenant-scoped", async () => {
    expect(getMigrationIds()).toContain("069_os1_conversation_action_plans");
    expect(getMigrationIds(true)).toEqual(
      expect.arrayContaining([
        "069_os1_conversation_action_plans",
        "070_os1_conversation_action_plans_rls",
      ]),
    );

    const db = await createMemoryDb();
    opened.push(db);
    const tables = await db.query<{ table_name: string }>(
      `select table_name
       from information_schema.tables
       where table_schema = 'public'
         and table_name in (
           'conversation_action_plans', 'conversation_action_plan_steps'
         )
       order by table_name`,
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual([
      "conversation_action_plan_steps",
      "conversation_action_plans",
    ]);

    const unsafeColumns = await db.query<{ column_name: string }>(
      `select column_name
       from information_schema.columns
       where table_schema = 'public'
         and table_name in (
           'conversation_action_plans', 'conversation_action_plan_steps'
         )
         and column_name in (
           'raw_llm_text', 'raw_prompt', 'credential', 'secret', 'token'
         )`,
    );
    expect(unsafeColumns.rows).toEqual([]);
  });

  it("refuse source inter-tenant, étape dupliquée et seconde validation", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    await seedConversation(db, "a");
    await seedConversation(db, "b");
    await seedPlan(db, "a");

    await expect(
      db.query(
        `insert into conversation_action_plans (
           id, tenant_id, thread_id, source_message_id, schema_version,
           generation_source, approval_status, intent, business_goal,
           confidence, risk_summary, estimated_cost_minor,
           estimated_cost_currency, plan_json, plan_fingerprint, created_by,
           created_at, updated_at
         ) values (
           'plan_cross', 'tenant_a', 'thread_a', 'message_b', 1,
           'deterministic_mock', 'awaiting_approval', 'Relance', 'Suivi',
           0.9, 'Risque borné', 0, 'EUR', '{}', $1, 'user_a', $2, $2
         )`,
        ["c".repeat(64), timestamp],
      ),
    ).rejects.toThrow(/foreign key|violates/i);

    await db.query(
      `insert into conversation_action_plan_steps (
         tenant_id, plan_id, position, step_id, capability, mode,
         execution_environment, risk, requires_approval, reversible,
         input_json, evidence_required_json, idempotency_key, status
       ) values (
         'tenant_a', 'plan_a', 0, 'search_contact', 'crm.contacts.search',
         'read', 'mock', 'low', 0, 'true', '{}', '[]',
         'plan_a_search_contact', 'planned'
       )`,
    );
    await expect(
      db.query(
        `update conversation_action_plans
         set plan_json = '{"altered":true}'
         where tenant_id = 'tenant_a' and id = 'plan_a'`,
      ),
    ).rejects.toThrow(/conversation_action_plan_immutable/i);
    await expect(
      db.query(
        `update conversation_action_plan_steps
         set capability = 'crm.contacts.delete'
         where tenant_id = 'tenant_a' and plan_id = 'plan_a'`,
      ),
    ).rejects.toThrow(/conversation_action_plan_step_immutable/i);
    await expect(
      db.query(
        `insert into conversation_action_plan_steps (
           tenant_id, plan_id, position, step_id, capability, mode,
           execution_environment, risk, requires_approval, reversible,
           input_json, evidence_required_json, idempotency_key, status
         ) values (
           'tenant_a', 'plan_a', 1, 'search_contact', 'project.task.create',
           'write', 'mock', 'medium', 1, 'true', '{}', '[]',
           'plan_a_search_contact', 'planned'
         )`,
      ),
    ).rejects.toThrow(/unique|duplicate/i);

    await db.query(
      `insert into approvals (
         id, tenant_id, requested_by, policy, status, target_type, target_id,
         created_at
       ) values (
         'approval_plan_a', 'tenant_a', 'user_a', 'single', 'pending',
         'conversation_action_plan', 'plan_a', $1
       )`,
      [timestamp],
    );
    await expect(
      db.query(
        `insert into approvals (
           id, tenant_id, requested_by, policy, status, target_type, target_id,
           created_at
         ) values (
           'approval_plan_a_duplicate', 'tenant_a', 'user_a', 'single',
           'pending', 'conversation_action_plan', 'plan_a', $1
         )`,
        [timestamp],
      ),
    ).rejects.toThrow(/unique|duplicate/i);
  });
});

type TestDb = Awaited<ReturnType<typeof createMemoryDb>>;

async function seedConversation(db: TestDb, suffix: "a" | "b") {
  await db.query(
    `insert into users (id, name, email, password_hash, created_at)
     values ($1, $2, $3, 'hash', $4)`,
    [
      `user_${suffix}`,
      `Utilisateur ${suffix}`,
      `${suffix}@example.com`,
      timestamp,
    ],
  );
  await db.query(
    `insert into tenants (id, name, slug, category, created_at)
     values ($1, $2, $3, 'Services', $4)`,
    [
      `tenant_${suffix}`,
      `Tenant ${suffix}`,
      `tenant-${suffix}`,
      timestamp,
    ],
  );
  await db.query(
    `insert into conversation_participants (
       id, tenant_id, role, display_name, created_at, updated_at
     ) values ($1, $2, 'member', 'Membre', $3, $3)`,
    [`participant_${suffix}`, `tenant_${suffix}`, timestamp],
  );
  await db.query(
    `insert into conversation_channel_identities (
       id, tenant_id, participant_id, channel_kind, adapter_key,
       external_subject_id, display_name, role, state, created_at, updated_at
     ) values ($1, $2, $3, 'web', 'web-chat', $4, 'Membre', 'member',
       'active', $5, $5)`,
    [
      `identity_${suffix}`,
      `tenant_${suffix}`,
      `participant_${suffix}`,
      `user_${suffix}`,
      timestamp,
    ],
  );
  await db.query(
    `insert into conversation_threads (
       id, tenant_id, status, created_at, updated_at, last_message_at
     ) values ($1, $2, 'open', $3, $3, $3)`,
    [`thread_${suffix}`, `tenant_${suffix}`, timestamp],
  );
  await db.query(
    `insert into conversation_messages (
       id, tenant_id, thread_id, channel_identity_id, direction, kind, status,
       text_content, adapter_key, external_message_id, idempotency_key,
       correlation_id, occurred_at, created_at
     ) values ($1, $2, $3, $4, 'inbound', 'text', 'received', 'Relance',
       'web-chat', $5, $6, $7, $8, $8)`,
    [
      `message_${suffix}`,
      `tenant_${suffix}`,
      `thread_${suffix}`,
      `identity_${suffix}`,
      `external_message_${suffix}`,
      `ingress:web:${suffix}`,
      `correlation_plan_${suffix}`,
      timestamp,
    ],
  );
}

async function seedPlan(db: TestDb, suffix: "a") {
  await db.query(
    `insert into conversation_action_plans (
       id, tenant_id, thread_id, source_message_id, schema_version,
       generation_source, approval_status, intent, business_goal, confidence,
       risk_summary, estimated_cost_minor, estimated_cost_currency, plan_json,
       plan_fingerprint, created_by, created_at, updated_at
     ) values (
       $1, $2, $3, $4, 1, 'deterministic_mock', 'awaiting_approval',
       'Préparer une relance', 'Créer un suivi', 0.96, 'Risque borné', 0,
       'EUR', '{}', $5, $6, $7, $7
     )`,
    [
      `plan_${suffix}`,
      `tenant_${suffix}`,
      `thread_${suffix}`,
      `message_${suffix}`,
      "a".repeat(64),
      `user_${suffix}`,
      timestamp,
    ],
  );
}
