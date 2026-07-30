import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import { ingestConversationMessage } from "../src/modules/conversation-hub";
import {
  createConversationActionPlan,
  decideConversationActionPlan,
  getConversationActionPlan,
} from "../src/modules/orchestrator";

const opened: Array<{ close: () => Promise<void> }> = [];
const occurredAt = "2026-07-30T10:00:00.000Z";

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("service des plans Conversation", () => {
  it("crée une seule proposition immuable et la rejoue sans fournisseur", async () => {
    const context = await createTenantContext("plan-owner@example.com");
    const source = await ingestConversationMessage(
      context.db,
      context.userId,
      ingressFixture(context.tenantId),
    );
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Aucun transport externe attendu."));
    const input = {
      tenantId: context.tenantId,
      threadId: source.threadId,
      sourceMessageId: source.messageId,
    };

    const created = await createConversationActionPlan(
      context.db,
      context.userId,
      input,
    );
    const replay = await createConversationActionPlan(
      context.db,
      context.userId,
      input,
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(created).toMatchObject({
      tenantId: context.tenantId,
      threadId: source.threadId,
      sourceMessageId: source.messageId,
      schemaVersion: 1,
      generationSource: "deterministic_mock",
      approvalStatus: "awaiting_approval",
      idempotentReplay: false,
      steps: [
        { capability: "crm.contacts.search", status: "planned" },
        { capability: "project.task.create", status: "planned" },
      ],
    });
    expect(created.approvalId).toBeTruthy();
    expect(replay).toMatchObject({
      id: created.id,
      approvalId: created.approvalId,
      planFingerprint: created.planFingerprint,
      idempotentReplay: true,
    });
    expect(created.planFingerprint).toMatch(/^[a-f0-9]{64}$/);

    const stored = await getConversationActionPlan(
      context.db,
      context.userId,
      context.tenantId,
      created.id,
    );
    expect(stored.plan).toEqual(created.plan);

    const counts = await context.db.query<{
      plans: number;
      steps: number;
      approvals: number;
    }>(
      `select
         (select count(*)::int from conversation_action_plans
          where tenant_id = $1) as plans,
         (select count(*)::int from conversation_action_plan_steps
          where tenant_id = $1) as steps,
         (select count(*)::int from approvals
          where tenant_id = $1
            and target_type = 'conversation_action_plan') as approvals`,
      [context.tenantId],
    );
    expect(counts.rows[0]).toEqual({ plans: 1, steps: 2, approvals: 1 });

    const thread = await context.db.query<{ status: string }>(
      `select status from conversation_threads
       where tenant_id = $1 and id = $2`,
      [context.tenantId, source.threadId],
    );
    expect(thread.rows[0]?.status).toBe("awaiting_validation");

    const messages = await context.db.query<{
      kind: string;
      text_content: string;
      adapter_key: string;
    }>(
      `select kind, text_content, adapter_key
       from conversation_messages
       where tenant_id = $1 and thread_id = $2
       order by created_at asc`,
      [context.tenantId, source.threadId],
    );
    expect(messages.rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "plan",
          adapter_key: "orchestrator-mock",
        }),
      ]),
    );

    const audits = await context.db.query<{
      action: string;
      safe_metadata: string;
    }>(
      `select action, safe_metadata from audit_logs
       where tenant_id = $1 and target_type = 'conversation_action_plan'`,
      [context.tenantId],
    );
    expect(audits.rows).toHaveLength(1);
    expect(audits.rows[0]?.action).toBe("conversation.plan_created");
    expect(audits.rows[0]?.safe_metadata).not.toContain(
      "Texte client confidentiel",
    );
    expect(audits.rows[0]?.safe_metadata).not.toContain("Relancer le contact");
  });

  it("applique une décision unique, auditée et idempotente", async () => {
    const context = await createTenantContext("decision-owner@example.com");
    const source = await ingestConversationMessage(
      context.db,
      context.userId,
      ingressFixture(context.tenantId),
    );
    const plan = await createConversationActionPlan(
      context.db,
      context.userId,
      {
        tenantId: context.tenantId,
        threadId: source.threadId,
        sourceMessageId: source.messageId,
      },
    );

    const approved = await decideConversationActionPlan(
      context.db,
      context.userId,
      context.tenantId,
      {
        planId: plan.id,
        decision: "approved",
        reason: "Validation métier confirmée.",
      },
    );
    const replay = await decideConversationActionPlan(
      context.db,
      context.userId,
      context.tenantId,
      {
        planId: plan.id,
        decision: "approved",
        reason: "Validation métier confirmée.",
      },
    );

    expect(approved).toMatchObject({
      approvalStatus: "approved",
      decision: "approved",
      idempotentReplay: false,
      steps: [{ status: "approved" }, { status: "approved" }],
    });
    expect(replay).toMatchObject({
      id: plan.id,
      approvalStatus: "approved",
      decision: "approved",
      idempotentReplay: true,
    });
    await expect(
      decideConversationActionPlan(
        context.db,
        context.userId,
        context.tenantId,
        {
          planId: plan.id,
          decision: "rejected",
          reason: "Décision opposée interdite.",
        },
      ),
    ).rejects.toMatchObject({ code: "orchestrator_decision_conflict" });

    const approval = await context.db.query<{ status: string }>(
      `select status from approvals
       where tenant_id = $1 and target_type = 'conversation_action_plan'
         and target_id = $2`,
      [context.tenantId, plan.id],
    );
    expect(approval.rows).toEqual([{ status: "approved" }]);

    const thread = await context.db.query<{ status: string }>(
      `select status from conversation_threads
       where tenant_id = $1 and id = $2`,
      [context.tenantId, source.threadId],
    );
    expect(thread.rows[0]?.status).toBe("open");

    const audit = await context.db.query<{
      action: string;
      safe_metadata: string;
    }>(
      `select action, safe_metadata from audit_logs
       where tenant_id = $1 and target_type = 'conversation_action_plan'
       order by created_at asc`,
      [context.tenantId],
    );
    expect(audit.rows.map((row) => row.action)).toEqual([
      "conversation.plan_created",
      "conversation.plan_approved",
    ]);
    expect(audit.rows[1]?.safe_metadata).toContain(plan.planFingerprint);
    expect(audit.rows[1]?.safe_metadata).not.toContain(
      "Validation métier confirmée",
    );
  });

  it("isole les tenants et réserve la décision aux rôles autorisés", async () => {
    const ownerA = await createTenantContext("tenant-plan-a@example.com");
    const ownerB = await createSecondUserAndTenant(
      ownerA.db,
      "tenant-plan-b@example.com",
    );
    const source = await ingestConversationMessage(
      ownerA.db,
      ownerA.userId,
      ingressFixture(ownerA.tenantId),
    );

    await expect(
      createConversationActionPlan(ownerA.db, ownerB.userId, {
        tenantId: ownerA.tenantId,
        threadId: source.threadId,
        sourceMessageId: source.messageId,
      }),
    ).rejects.toMatchObject({ code: "tenant_access_denied" });
    await expect(
      getConversationActionPlan(
        ownerA.db,
        ownerB.userId,
        ownerB.tenantId,
        "plan_inconnu",
      ),
    ).rejects.toMatchObject({ code: "orchestrator_plan_not_found" });

    await ownerA.db.query(
      `insert into memberships (tenant_id, user_id, role, created_at)
       values ($1, $2, 'collaborator', $3)`,
      [ownerA.tenantId, ownerB.userId, occurredAt],
    );
    const plan = await createConversationActionPlan(
      ownerA.db,
      ownerB.userId,
      {
        tenantId: ownerA.tenantId,
        threadId: source.threadId,
        sourceMessageId: source.messageId,
      },
    );
    await expect(
      decideConversationActionPlan(
        ownerA.db,
        ownerB.userId,
        ownerA.tenantId,
        {
          planId: plan.id,
          decision: "approved",
          reason: "Décision non autorisée.",
        },
      ),
    ).rejects.toMatchObject({ code: "tenant_access_denied" });
  });
});

type TestDb = Awaited<ReturnType<typeof createMemoryDb>>;

async function createTenantContext(email: string) {
  const db = await createMemoryDb();
  opened.push(db);
  return createSecondUserAndTenant(db, email);
}

async function createSecondUserAndTenant(db: TestDb, email: string) {
  const services = createServices(db);
  const user = await services.registerUser({
    name: "Responsable plan",
    email,
    password: "Password!1",
  });
  const tenant = await services.createTenant(user.id, {
    name: `Organisation ${email}`,
    category: "Services",
  });
  return { db, userId: user.id, tenantId: tenant.id };
}

function ingressFixture(tenantId: string) {
  return {
    tenantId,
    channelIdentity: {
      id: `identity_${tenantId}`,
      tenantId,
      participantId: `participant_${tenantId}`,
      channelKind: "web" as const,
      adapterKey: "web-chat",
      externalSubjectId: `member_${tenantId}`,
      displayName: "Membre de démonstration",
      role: "member" as const,
      state: "active" as const,
      createdAt: occurredAt,
      updatedAt: occurredAt,
    },
    externalMessageId: `external_${tenantId}`,
    idempotencyKey: `ingress:web:${tenantId}`,
    correlationId: `correlation_${tenantId}`,
    routeTrace: [],
    text: "Texte client confidentiel à ne jamais placer dans l'audit.",
    attachments: [],
    occurredAt,
  };
}
