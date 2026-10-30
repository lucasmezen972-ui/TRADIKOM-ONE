import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, describe, expect, it } from "vitest";
import {
  findConversationActionPlanPolicyReceiptByPlan,
  insertConversationActionPlanPolicyReceipt,
  lockActionPlanApproval,
  lockActionPlanRow,
  lockConversationActionPlanPolicyReceiptByPlan,
} from "../src/modules/orchestrator/repository";
import { getMigrationIds, migrate } from "../src/lib/db";

const opened: PGlite[] = [];
const timestamp = "2026-09-11T04:15:00.000Z";
const userId = "user_policy_receipt";
const tenantId = "tenant_policy_receipt";
const planId = "plan_policy_receipt";
const approvalId = "approval_policy_receipt";
const planFingerprint = "a".repeat(64);
const receiptFingerprint = "b".repeat(64);

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("migrations des reçus de policy Conversation", () => {
  it("garde les migrations runtime et leurs miroirs SQL identiques", () => {
    const runtime = readFileSync(
      new URL("../src/lib/db.ts", import.meta.url),
      "utf8",
    );
    const storage = readFileSync(
      new URL(
        "../src/db/migrations/0110_os5_conversation_action_plan_policy_receipts.sql",
        import.meta.url,
      ),
      "utf8",
    );
    const rls = readFileSync(
      new URL(
        "../src/db/migrations/0111_os5_conversation_action_plan_policy_receipts_rls.sql",
        import.meta.url,
      ),
      "utf8",
    );

    expect(
      extractSqlTemplate(
        runtime,
        "os5ConversationActionPlanPolicyReceiptsMigrationSql",
      ).trim(),
    ).toBe(storage.trim());
    expect(
      extractSqlTemplate(
        runtime,
        "os5ConversationActionPlanPolicyReceiptsRlsMigrationSql",
      ).trim(),
    ).toBe(rls.trim());
    expect(rls).toContain("with check (app_is_system());");
    expect(rls).not.toContain("actor_membership");
    expect(getMigrationIds()).toContain(
      "116_os5_conversation_action_plan_policy_receipts",
    );
    expect(getMigrationIds(true)).toContain(
      "117_os5_conversation_action_plan_policy_receipts_rls",
    );
  });

  it("met à niveau, lie le reçu au plan et à la validation, puis interdit sa mutation", async () => {
    const db = new PGlite();
    opened.push(db);
    await migrate(db, {
      targetMigrationId: "115_os5_whatsapp_meta_trial_authorization",
    });
    await seedConversation(db);
    await seedApprovedPlan(db, {
      planId,
      approvalId,
      fingerprint: planFingerprint,
    });
    await seedApprovedPlan(db, {
      planId: "plan_policy_receipt_other",
      approvalId: "approval_policy_receipt_other",
      fingerprint: "c".repeat(64),
    });

    await migrate(db);

    const columns = await db.query<{ column_name: string; data_type: string }>(
      `select column_name, data_type
       from information_schema.columns
       where table_schema = 'public'
         and table_name = 'conversation_action_plan_policy_receipts'
         and column_name in ('id', 'tenant_id', 'payload_json')
       order by column_name`,
    );
    expect(columns.rows).toEqual([
      { column_name: "id", data_type: "uuid" },
      { column_name: "payload_json", data_type: "jsonb" },
      { column_name: "tenant_id", data_type: "text" },
    ]);

    const payloadJson = policyPayloadJson({
      tenantId,
      planId,
      planFingerprint,
      approvalId,
    });
    await expect(
      insertConversationActionPlanPolicyReceipt(db, {
        id: "1638a90c-5a0d-44cb-a03c-1af1350f40c0",
        tenantId,
        planId,
        planFingerprint: "d".repeat(64),
        approvalId,
        approvalMode: "single",
        approvedByUserId: userId,
        payloadJson: policyPayloadJson({
          tenantId,
          planId,
          planFingerprint: "d".repeat(64),
          approvalId,
        }),
        receiptFingerprint: "e".repeat(64),
        createdAt: timestamp,
      }),
    ).rejects.toThrow(/binding_invalid|foreign key|violates/i);
    await expect(
      insertConversationActionPlanPolicyReceipt(db, {
        id: "7b1cbbae-6fb6-4fe6-aedd-c631c2da681c",
        tenantId,
        planId: "plan_policy_receipt_other",
        planFingerprint: "c".repeat(64),
        approvalId,
        approvalMode: "single",
        approvedByUserId: userId,
        payloadJson: policyPayloadJson({
          tenantId,
          planId: "plan_policy_receipt_other",
          planFingerprint: "c".repeat(64),
          approvalId,
        }),
        receiptFingerprint: "f".repeat(64),
        createdAt: timestamp,
      }),
    ).rejects.toThrow(/binding_invalid|foreign key|violates/i);
    await expect(
      insertConversationActionPlanPolicyReceipt(db, {
        id: "ff2733a9-a998-4fb3-8df0-fe598b810388",
        tenantId,
        planId,
        planFingerprint,
        approvalId,
        approvalMode: "single",
        approvedByUserId: "user_policy_receipt_other",
        payloadJson,
        receiptFingerprint: "0".repeat(64),
        createdAt: timestamp,
      }),
    ).rejects.toThrow(/binding_invalid|foreign key|violates/i);
    await expect(
      insertConversationActionPlanPolicyReceipt(db, {
        id: "643a6b3f-6841-476c-a4e1-ab2f467063df",
        tenantId,
        planId,
        planFingerprint,
        approvalId,
        approvalMode: "single",
        approvedByUserId: userId,
        payloadJson: payloadJson.replace("tradikom_mock", "provider_unknown"),
        receiptFingerprint: "1".repeat(64),
        createdAt: timestamp,
      }),
    ).rejects.toThrow(/check constraint|violates/i);
    const incompletePayload = JSON.parse(payloadJson) as Record<
      string,
      unknown
    >;
    delete incompletePayload.provider;
    await expect(
      insertConversationActionPlanPolicyReceipt(db, {
        id: "0799ba3e-e52d-4460-b5c7-bc722044b5fb",
        tenantId,
        planId,
        planFingerprint,
        approvalId,
        approvalMode: "single",
        approvedByUserId: userId,
        payloadJson: JSON.stringify(incompletePayload),
        receiptFingerprint: "9".repeat(64),
        createdAt: timestamp,
      }),
    ).rejects.toThrow(/check constraint|violates/i);

    const inserted = await insertConversationActionPlanPolicyReceipt(db, {
      id: "609d73c9-088a-4891-a539-a39de88f8dad",
      tenantId,
      planId,
      planFingerprint,
      approvalId,
      approvalMode: "single",
      approvedByUserId: userId,
      payloadJson,
      receiptFingerprint,
      createdAt: timestamp,
    });
    expect(inserted).toMatchObject({
      tenant_id: tenantId,
      plan_id: planId,
      plan_fingerprint: planFingerprint,
      approval_id: approvalId,
      approval_mode: "single",
      approval_status: "approved",
      approved_by_user_id: userId,
      receipt_fingerprint: receiptFingerprint,
    });
    expect(JSON.parse(inserted!.payload_json)).toEqual(JSON.parse(payloadJson));
    expect(
      await findConversationActionPlanPolicyReceiptByPlan(
        db,
        tenantId,
        planId,
      ),
    ).toEqual(inserted);
    expect(
      await lockConversationActionPlanPolicyReceiptByPlan(
        db,
        tenantId,
        planId,
      ),
    ).toEqual(inserted);
    expect((await lockActionPlanRow(db, tenantId, planId))?.id).toBe(planId);
    expect(
      (await lockActionPlanApproval(db, tenantId, planId))?.id,
    ).toBe(approvalId);
    expect(
      await insertConversationActionPlanPolicyReceipt(db, {
        id: "1e03605e-d907-476f-ac94-d8f6e62e93cb",
        tenantId,
        planId,
        planFingerprint,
        approvalId,
        approvalMode: "single",
        approvedByUserId: userId,
        payloadJson,
        receiptFingerprint: "2".repeat(64),
        createdAt: timestamp,
      }),
    ).toBeNull();

    await expect(
      db.query(
        `update conversation_action_plan_policy_receipts
         set receipt_fingerprint = $1
         where tenant_id = $2 and plan_id = $3`,
        ["3".repeat(64), tenantId, planId],
      ),
    ).rejects.toThrow(/conversation_action_plan_policy_receipt_immutable/i);
    await expect(
      db.query(
        `delete from conversation_action_plan_policy_receipts
         where tenant_id = $1 and plan_id = $2`,
        [tenantId, planId],
      ),
    ).rejects.toThrow(/conversation_action_plan_policy_receipt_immutable/i);

    await db.query(`delete from tenants where id = $1`, [tenantId]);
    const cascaded = await db.query<{
      tenants: number;
      plans: number;
      approvals: number;
      receipts: number;
    }>(
      `select
         (select count(*)::int from tenants where id = $1) as tenants,
         (select count(*)::int from conversation_action_plans
          where tenant_id = $1) as plans,
         (select count(*)::int from approvals
          where tenant_id = $1) as approvals,
         (select count(*)::int
          from conversation_action_plan_policy_receipts
          where tenant_id = $1) as receipts`,
      [tenantId],
    );
    expect(cascaded.rows[0]).toEqual({
      tenants: 0,
      plans: 0,
      approvals: 0,
      receipts: 0,
    });
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

function policyPayloadJson(input: {
  tenantId: string;
  planId: string;
  planFingerprint: string;
  approvalId: string;
}) {
  return JSON.stringify({
    schemaVersion: 1,
    tenantId: input.tenantId,
    plan: { id: input.planId, fingerprint: input.planFingerprint },
    approval: { mode: "single", id: input.approvalId, status: "approved" },
    catalog: {
      fingerprint: "4".repeat(64),
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
      role: "owner",
      allowedRoles: ["administrator", "collaborator", "manager", "owner"],
      requiredScopes: ["crm.contacts.read", "project.tasks.write"],
    },
    capabilities: ["crm.contacts.search", "project.task.create"],
    risk: {
      maximum: "medium",
      steps: [
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
      ],
    },
  });
}

async function seedConversation(db: PGlite) {
  await db.query(
    `insert into users (id, name, email, password_hash, created_at)
     values
       ($1, 'Décideur', 'policy-receipt@example.test', 'hash', $3),
       ($2, 'Autre décideur', 'policy-receipt-other@example.test', 'hash', $3)`,
    [userId, "user_policy_receipt_other", timestamp],
  );
  await db.query(
    `insert into tenants (id, name, slug, category, created_at)
     values ($1, 'Organisation Policy', 'organisation-policy', 'Services', $2)`,
    [tenantId, timestamp],
  );
  await db.query(
    `insert into memberships (tenant_id, user_id, role, created_at)
     values ($1, $2, 'owner', $3)`,
    [tenantId, userId, timestamp],
  );
  await db.query(
    `insert into conversation_participants (
       id, tenant_id, role, display_name, created_at, updated_at
     ) values ('participant_policy_receipt', $1, 'member', 'Décideur', $2, $2)`,
    [tenantId, timestamp],
  );
  await db.query(
    `insert into conversation_channel_identities (
       id, tenant_id, participant_id, channel_kind, adapter_key,
       external_subject_id, display_name, role, state, created_at, updated_at
     ) values (
       'identity_policy_receipt', $1, 'participant_policy_receipt', 'web',
       'web-chat', $2, 'Décideur', 'member', 'active', $3, $3
     )`,
    [tenantId, userId, timestamp],
  );
  await db.query(
    `insert into conversation_threads (
       id, tenant_id, status, subject, created_at, updated_at
     ) values (
       'thread_policy_receipt', $1, 'open', 'Policy', $2, $2
     )`,
    [tenantId, timestamp],
  );
  await db.query(
    `insert into conversation_messages (
       id, tenant_id, thread_id, channel_identity_id, direction, kind, status,
       text_content, adapter_key, external_message_id, idempotency_key,
       correlation_id, occurred_at, created_at
     ) values (
       'message_policy_receipt', $1, 'thread_policy_receipt',
       'identity_policy_receipt', 'inbound', 'text', 'received', 'Préparer',
       'web-chat', 'external_policy_receipt', 'ingress:policy:receipt',
       'correlation_policy_receipt', $2, $2
     )`,
    [tenantId, timestamp],
  );
}

async function seedApprovedPlan(
  db: PGlite,
  input: { planId: string; approvalId: string; fingerprint: string },
) {
  await db.query(
    `insert into conversation_action_plans (
       id, tenant_id, thread_id, source_message_id, schema_version,
       generation_source, approval_status, intent, business_goal, confidence,
       risk_summary, estimated_cost_minor, estimated_cost_currency, plan_json,
       plan_fingerprint, created_by, created_at, updated_at, decided_by,
       decided_at, decision_reason
     ) values (
       $1, $2, 'thread_policy_receipt', 'message_policy_receipt', 1,
       'deterministic_mock', 'approved', 'Préparer une relance',
       'Créer un suivi', 0.95, 'Risque borné', 0, 'EUR', '{}', $3, $4, $5,
       $5, $4, $5, 'Validation explicite'
     )`,
    [input.planId, tenantId, input.fingerprint, userId, timestamp],
  );
  await db.query(
    `insert into approvals (
       id, tenant_id, requested_by, policy, status, target_type, target_id,
       created_at
     ) values (
       $1, $2, $3, 'single', 'approved', 'conversation_action_plan', $4, $5
     )`,
    [input.approvalId, tenantId, userId, input.planId, timestamp],
  );
}
