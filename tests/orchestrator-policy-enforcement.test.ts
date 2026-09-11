import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { hashToken } from "../src/lib/security";
import { createServices } from "../src/lib/services";
import { ingestConversationMessage } from "../src/modules/conversation-hub";
import { strictMockCapabilityProvider } from "../src/modules/connector-execution";
import {
  createConversationActionPlan,
  decideConversationActionPlan,
  executeConversationActionPlan,
  findActionPlanRow,
  findConversationActionPlanPolicyReceiptByPlan,
  listActionPlanStepRows,
  type ConversationActionPlanPolicyReceiptRow,
  type ConversationActionPlanRow,
  type ConversationActionPlanStepRow,
} from "../src/modules/orchestrator";
import { buildConversationPlanWorkflow } from "../src/modules/orchestrator/workflow-plan";
import {
  executeWorkflowAction,
  executeWorkflowDefinition,
  type WorkflowDefinition,
  type WorkflowEvent,
} from "../src/modules/workflows";

const opened: Array<{ close: () => Promise<void> }> = [];
const occurredAt = "2026-09-11T04:00:00.000Z";

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("enforcement durable de la policy des plans Conversation", () => {
  it("émet exactement un reçu lors de la validation unique et aucun lors du rejet", async () => {
    const approvedContext = await createTenantContext(
      "policy-approved@example.com",
    );
    const approvedPlan = await createPendingPlan(approvedContext);

    expect(
      await countPolicyReceipts(
        approvedContext.db,
        approvedContext.tenantId,
        approvedPlan.id,
      ),
    ).toBe(0);
    await decideConversationActionPlan(
      approvedContext.db,
      approvedContext.userId,
      approvedContext.tenantId,
      {
        planId: approvedPlan.id,
        decision: "approved",
        reason: "Validation serveur unique pour le test.",
      },
    );
    await decideConversationActionPlan(
      approvedContext.db,
      approvedContext.userId,
      approvedContext.tenantId,
      {
        planId: approvedPlan.id,
        decision: "approved",
        reason: "Rejeu idempotent de la même validation.",
      },
    );

    const receipt = await findConversationActionPlanPolicyReceiptByPlan(
      approvedContext.db,
      approvedContext.tenantId,
      approvedPlan.id,
    );
    expect(receipt).toMatchObject({
      tenant_id: approvedContext.tenantId,
      plan_id: approvedPlan.id,
      plan_fingerprint: approvedPlan.planFingerprint,
      approval_id: approvedPlan.approvalId,
      approval_mode: "single",
      approval_status: "approved",
      approved_by_user_id: approvedContext.userId,
    });
    expect(receipt?.receipt_fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(
      await countPolicyReceipts(
        approvedContext.db,
        approvedContext.tenantId,
        approvedPlan.id,
      ),
    ).toBe(1);

    const rejectedContext = await createTenantContext(
      "policy-rejected@example.com",
    );
    const rejectedPlan = await createPendingPlan(rejectedContext);
    await decideConversationActionPlan(
      rejectedContext.db,
      rejectedContext.userId,
      rejectedContext.tenantId,
      {
        planId: rejectedPlan.id,
        decision: "rejected",
        reason: "Rejet métier sans autorisation d'exécution.",
      },
    );

    expect(
      await countPolicyReceipts(
        rejectedContext.db,
        rejectedContext.tenantId,
        rejectedPlan.id,
      ),
    ).toBe(0);
  });

  it("refuse un plan historique approuvé sans reçu avant événement, mission ou fournisseur", async () => {
    const context = await createTenantContext("policy-history@example.com");
    const plan = await createPendingPlan(context);
    await context.db.query(
      `update approvals
       set status = 'approved'
       where tenant_id = $1 and id = $2 and status = 'pending'`,
      [context.tenantId, plan.approvalId],
    );
    await context.db.query(
      `update conversation_action_plans
       set approval_status = 'approved', decided_by = $1,
         decided_at = created_at, decision_reason = 'Décision historique.',
         updated_at = created_at
       where tenant_id = $2 and id = $3`,
      [context.userId, context.tenantId, plan.id],
    );
    await context.db.query(
      `update conversation_action_plan_steps
       set status = 'approved'
       where tenant_id = $1 and plan_id = $2`,
      [context.tenantId, plan.id],
    );
    const providerSpy = vi.spyOn(strictMockCapabilityProvider, "execute");

    await expect(
      executeConversationActionPlan(
        context.db,
        context.userId,
        context.tenantId,
        plan.id,
      ),
    ).rejects.toMatchObject({
      code: "orchestrator_policy_receipt_invalid",
    });
    expect(providerSpy).not.toHaveBeenCalled();
    await expectNoWorkflowWrites(context, plan.id);

    const durable = await context.db.query<{
      approvalStatus: string;
      receiptCount: number;
      approvedSteps: number;
    }>(
      `select
         (select approval_status from conversation_action_plans
          where tenant_id = $1 and id = $2) as "approvalStatus",
         (select count(*)::int
          from conversation_action_plan_policy_receipts
          where tenant_id = $1 and plan_id = $2) as "receiptCount",
         (select count(*)::int from conversation_action_plan_steps
          where tenant_id = $1 and plan_id = $2 and status = 'approved')
           as "approvedSteps"`,
      [context.tenantId, plan.id],
    );
    expect(durable.rows[0]).toEqual({
      approvalStatus: "approved",
      receiptCount: 0,
      approvedSteps: 2,
    });
  });

  it("refuse un binding d'événement falsifié et une définition injectée avant toute écriture ou action", async () => {
    const context = await createTenantContext("policy-binding@example.com");
    const authorized = await createAuthorizedFixture(context);
    const providerSpy = vi.spyOn(strictMockCapabilityProvider, "execute");
    const validEvent = executionEvent(context.userId, authorized);
    const forgedEvent: WorkflowEvent = {
      ...validEvent,
      payload: {
        ...validEvent.payload,
        policyReceipt: {
          id: authorized.receipt.id,
          fingerprint: "f".repeat(64),
          schemaVersion: 1,
        },
      },
    };

    await expect(
      executeWorkflowDefinition(
        context.db,
        authorized.definition,
        forgedEvent,
      ),
    ).rejects.toMatchObject({
      code: "orchestrator_policy_receipt_invalid",
    });

    const injectedDefinition: WorkflowDefinition = {
      ...authorized.definition,
      actions: authorized.definition.actions.map((action, index) =>
        index === 0
          ? {
              ...action,
              input: {
                ...action.input,
                capabilityInput: { query: "entrée injectée" },
              },
            }
          : action,
      ),
    };
    await expect(
      executeWorkflowDefinition(context.db, injectedDefinition, validEvent),
    ).rejects.toMatchObject({
      code: "orchestrator_policy_receipt_invalid",
    });

    const disguisedDefinition: WorkflowDefinition = {
      ...authorized.definition,
      key: "workflow_generique_falsifie",
      trigger: "workflow.generique.falsifie",
    };
    const disguisedEvent: WorkflowEvent = {
      ...validEvent,
      type: disguisedDefinition.trigger,
    };
    await expect(
      executeWorkflowDefinition(
        context.db,
        disguisedDefinition,
        disguisedEvent,
      ),
    ).rejects.toMatchObject({
      code: "orchestrator_policy_receipt_invalid",
    });
    await expect(
      executeWorkflowAction({
        db: context.db,
        runId: "run_falsifie",
        event: disguisedEvent,
        definition: disguisedDefinition,
        action: disguisedDefinition.actions[0]!,
        actionIndex: 0,
        actionIdempotencyKey: "action_falsifiee",
        now: occurredAt,
      }),
    ).rejects.toMatchObject({
      code: "orchestrator_policy_receipt_invalid",
    });

    const genericDefinition: WorkflowDefinition = {
      key: "workflow_generique_sans_mission",
      version: 1,
      trigger: "workflow.generique",
      active: true,
      conditions: [],
      actions: [
        {
          type: "create_activity",
          input: { summary: "Action générique autorisée" },
        },
      ],
      retryPolicy: { maxAttempts: 3, backoffMs: 0 },
      timeoutMs: 1_000,
      approvalPolicy: "no_approval_required",
    };
    const genericEvent: WorkflowEvent = {
      id: "event_generique_sans_mission",
      tenantId: context.tenantId,
      actorId: context.userId,
      type: genericDefinition.trigger,
      payload: {},
      correlationId: "correlation_generique_sans_mission",
      idempotencyKey: "workflow.generique:sans-mission",
    };
    await expect(
      executeWorkflowAction({
        db: context.db,
        runId: "run_absent",
        event: genericEvent,
        definition: genericDefinition,
        action: {
          type: "mock_create_task",
          input: {
            planStepId: "etape_injectee",
            capabilityInput: { title: "Tâche injectée" },
          },
        },
        actionIndex: 0,
        actionIdempotencyKey: "action_mock_injectee",
        now: occurredAt,
      }),
    ).rejects.toMatchObject({
      code: "orchestrator_policy_receipt_invalid",
    });

    const canonicalAction = authorized.definition.actions[0]!;
    const substitutedAction = authorized.definition.actions[1]!;
    await expect(
      executeWorkflowAction({
        db: context.db,
        runId: "run_falsifie",
        event: validEvent,
        definition: authorized.definition,
        action: substitutedAction,
        actionIndex: 0,
        actionIdempotencyKey:
          substitutedAction.idempotencyKey ?? "cle_action_substituee",
        now: occurredAt,
      }),
    ).rejects.toMatchObject({
      code: "orchestrator_policy_receipt_invalid",
    });
    await expect(
      executeWorkflowAction({
        db: context.db,
        runId: "run_falsifie",
        event: validEvent,
        definition: authorized.definition,
        action: canonicalAction,
        actionIndex: 0,
        actionIdempotencyKey:
          canonicalAction.idempotencyKey ??
          `${validEvent.idempotencyKey}:a0:${canonicalAction.type}`,
        now: occurredAt,
      }),
    ).rejects.toMatchObject({
      code: "orchestrator_policy_receipt_invalid",
    });

    expect(providerSpy).not.toHaveBeenCalled();
    await expectNoWorkflowWrites(context, authorized.plan.id);
  });

  it("refuse l'exécution si le rôle durable du principal dérive après émission", async () => {
    const context = await createTenantContext("policy-role-drift@example.com");
    const authorized = await createAuthorizedFixture(context);
    await context.db.query(
      `update memberships set role = 'administrator'
       where tenant_id = $1 and user_id = $2`,
      [context.tenantId, context.userId],
    );
    const providerSpy = vi.spyOn(strictMockCapabilityProvider, "execute");

    await expect(
      executeConversationActionPlan(
        context.db,
        context.userId,
        context.tenantId,
        authorized.plan.id,
      ),
    ).rejects.toMatchObject({
      code: "orchestrator_policy_receipt_invalid",
    });

    expect(providerSpy).not.toHaveBeenCalled();
    await expectNoWorkflowWrites(context, authorized.plan.id);
  });

  it("revalide toutes les preuves durables lors d'un rejeu déjà exécuté", async () => {
    const missingEvent = await createTenantContext(
      "policy-replay-event@example.com",
    );
    const eventFixture = await createAuthorizedFixture(missingEvent);
    await executeConversationActionPlan(
      missingEvent.db,
      missingEvent.userId,
      missingEvent.tenantId,
      eventFixture.plan.id,
    );
    await missingEvent.db.query(
      `delete from domain_events
       where tenant_id = $1 and id = $2`,
      [
        missingEvent.tenantId,
        `event_${hashToken(eventFixture.plan.id).slice(0, 32)}`,
      ],
    );
    await expect(
      executeConversationActionPlan(
        missingEvent.db,
        missingEvent.userId,
        missingEvent.tenantId,
        eventFixture.plan.id,
      ),
    ).rejects.toMatchObject({
      code: "orchestrator_policy_receipt_invalid",
    });

    const missingSteps = await createTenantContext(
      "policy-replay-steps@example.com",
    );
    const stepsFixture = await createAuthorizedFixture(missingSteps);
    const execution = await executeConversationActionPlan(
      missingSteps.db,
      missingSteps.userId,
      missingSteps.tenantId,
      stepsFixture.plan.id,
    );
    await missingSteps.db.query(
      `delete from workflow_run_steps
       where tenant_id = $1 and workflow_run_id = $2`,
      [missingSteps.tenantId, execution.execution.workflowRunId],
    );
    await expect(
      executeConversationActionPlan(
        missingSteps.db,
        missingSteps.userId,
        missingSteps.tenantId,
        stepsFixture.plan.id,
      ),
    ).rejects.toMatchObject({ code: "orchestrator_execution_failed" });

    const projectionContext = await createTenantContext(
      "policy-replay-projection@example.com",
    );
    const projectionFixture = await createAuthorizedFixture(projectionContext);
    const projectedExecution = await executeConversationActionPlan(
      projectionContext.db,
      projectionContext.userId,
      projectionContext.tenantId,
      projectionFixture.plan.id,
    );
    await projectionContext.db.query(
      `update conversation_messages
       set correlation_id = 'run_falsifie'
       where tenant_id = $1 and idempotency_key = $2`,
      [
        projectionContext.tenantId,
        `orchestrator:${projectionFixture.plan.id}:executed`,
      ],
    );
    await expect(
      executeConversationActionPlan(
        projectionContext.db,
        projectionContext.userId,
        projectionContext.tenantId,
        projectionFixture.plan.id,
      ),
    ).rejects.toMatchObject({ code: "orchestrator_execution_failed" });

    await projectionContext.db.query(
      `update conversation_messages
       set correlation_id = $1
       where tenant_id = $2 and idempotency_key = $3`,
      [
        projectedExecution.execution.workflowRunId,
        projectionContext.tenantId,
        `orchestrator:${projectionFixture.plan.id}:executed`,
      ],
    );
    await projectionContext.db.query(
      `update audit_logs
       set safe_metadata = '{}'
       where tenant_id = $1 and target_id = $2
         and action = 'conversation.plan_executed'`,
      [projectionContext.tenantId, projectionFixture.plan.id],
    );
    await expect(
      executeConversationActionPlan(
        projectionContext.db,
        projectionContext.userId,
        projectionContext.tenantId,
        projectionFixture.plan.id,
      ),
    ).rejects.toMatchObject({ code: "orchestrator_execution_failed" });
  });

  it("annule atomiquement toute l'exécution si la finalisation durable échoue", async () => {
    const context = await createTenantContext("policy-atomic@example.com");
    const authorized = await createAuthorizedFixture(context);
    let injected = false;
    const faultingDb = {
      query: async <T = Record<string, unknown>>(
        sql: string,
        params?: unknown[],
      ) => {
        if (
          !injected &&
          sql.includes("insert into conversation_messages") &&
          params?.[10] === `orchestrator:${authorized.plan.id}:executed`
        ) {
          injected = true;
          throw new Error("injected_result_message_failure");
        }
        return context.db.query<T>(sql, params);
      },
    };

    await expect(
      executeConversationActionPlan(
        faultingDb,
        context.userId,
        context.tenantId,
        authorized.plan.id,
      ),
    ).rejects.toThrow("injected_result_message_failure");
    expect(injected).toBe(true);

    const rolledBack = await context.db.query<{
      approvalStatus: string;
      approvedSteps: number;
      events: number;
      runs: number;
      resultMessages: number;
      executionAudits: number;
      failureAudits: number;
    }>(
      `select
         (select approval_status from conversation_action_plans
          where tenant_id = $1 and id = $2) as "approvalStatus",
         (select count(*)::int from conversation_action_plan_steps
          where tenant_id = $1 and plan_id = $2 and status = 'approved')
           as "approvedSteps",
         (select count(*)::int from domain_events
          where tenant_id = $1 and idempotency_key = $3) as events,
         (select count(*)::int from workflow_runs
          where tenant_id = $1 and workflow_key = $4) as runs,
         (select count(*)::int from conversation_messages
          where tenant_id = $1 and idempotency_key = $5) as "resultMessages",
         (select count(*)::int from audit_logs
          where tenant_id = $1 and target_id = $2
            and action = 'conversation.plan_executed') as "executionAudits",
         (select count(*)::int from audit_logs
          where tenant_id = $1 and target_id = $2
            and action = 'conversation.plan_execution_failed') as "failureAudits"`,
      [
        context.tenantId,
        authorized.plan.id,
        `conversation.plan.execute:${authorized.plan.id}`,
        `conversation_plan:${authorized.plan.id}`,
        `orchestrator:${authorized.plan.id}:executed`,
      ],
    );
    expect(rolledBack.rows[0]).toEqual({
      approvalStatus: "approved",
      approvedSteps: 2,
      events: 0,
      runs: 0,
      resultMessages: 0,
      executionAudits: 0,
      failureAudits: 0,
    });

    const retried = await executeConversationActionPlan(
      context.db,
      context.userId,
      context.tenantId,
      authorized.plan.id,
    );
    expect(retried).toMatchObject({
      approvalStatus: "executed",
      execution: { status: "succeeded", externalSideEffect: false },
    });
  });

  it("lie l'autorisation automatique du collaborateur puis réserve l'exécution au responsable", async () => {
    const context = await createTenantContext("policy-auto-owner@example.com");
    const services = createServices(context.db);
    const collaborator = await services.registerUser({
      name: "Collaboratrice policy",
      email: "policy-auto-collaborator@example.com",
      password: "Password!1",
    });
    await context.db.query(
      `insert into memberships (tenant_id, user_id, role, created_at)
       values ($1, $2, 'collaborator', $3)`,
      [context.tenantId, collaborator.id, occurredAt],
    );
    const source = await ingestConversationMessage(
      context.db,
      context.userId,
      ingressFixture(context.tenantId),
    );
    const created = await createConversationActionPlan(
      context.db,
      collaborator.id,
      {
        tenantId: context.tenantId,
        threadId: source.threadId,
        sourceMessageId: source.messageId,
      },
      { generator: automaticReadOnlyPlanGenerator() },
    );
    expect(created).toMatchObject({
      approvalStatus: "approved",
      policyReceipt: { schemaVersion: 1 },
    });
    const receipt = await findConversationActionPlanPolicyReceiptByPlan(
      context.db,
      context.tenantId,
      created.id,
    );
    expect(receipt).toMatchObject({
      approval_id: null,
      approval_mode: "none",
      approval_status: "not_required",
      approved_by_user_id: collaborator.id,
    });

    await expect(
      executeConversationActionPlan(
        context.db,
        collaborator.id,
        context.tenantId,
        created.id,
      ),
    ).rejects.toMatchObject({ code: "tenant_access_denied" });
    const execution = await executeConversationActionPlan(
      context.db,
      context.userId,
      context.tenantId,
      created.id,
    );
    expect(execution).toMatchObject({
      approvalStatus: "executed",
      execution: { status: "succeeded", externalSideEffect: false },
    });
  });
});

type TestDb = Awaited<ReturnType<typeof createMemoryDb>>;
type TenantContext = {
  db: TestDb;
  userId: string;
  tenantId: string;
};

async function createTenantContext(email: string): Promise<TenantContext> {
  const db = await createMemoryDb();
  opened.push(db);
  const services = createServices(db);
  const user = await services.registerUser({
    name: "Responsable policy",
    email,
    password: "Password!1",
  });
  const tenant = await services.createTenant(user.id, {
    name: `Organisation ${email}`,
    category: "Services",
  });
  return { db, userId: user.id, tenantId: tenant.id };
}

async function createPendingPlan(context: TenantContext) {
  const source = await ingestConversationMessage(
    context.db,
    context.userId,
    ingressFixture(context.tenantId),
  );
  return createConversationActionPlan(context.db, context.userId, {
    tenantId: context.tenantId,
    threadId: source.threadId,
    sourceMessageId: source.messageId,
  });
}

async function createAuthorizedFixture(context: TenantContext) {
  const created = await createPendingPlan(context);
  await decideConversationActionPlan(
    context.db,
    context.userId,
    context.tenantId,
    {
      planId: created.id,
      decision: "approved",
      reason: "Autorisation serveur pour la preuve d'enforcement.",
    },
  );
  const [plan, steps, receipt] = await Promise.all([
    findActionPlanRow(context.db, context.tenantId, created.id),
    listActionPlanStepRows(context.db, context.tenantId, created.id),
    findConversationActionPlanPolicyReceiptByPlan(
      context.db,
      context.tenantId,
      created.id,
    ),
  ]);
  if (!plan || !receipt) {
    throw new Error("Fixture de policy durable incomplète.");
  }
  return {
    plan,
    steps,
    receipt,
    definition: buildConversationPlanWorkflow(plan, steps),
  };
}

function executionEvent(
  actorId: string,
  fixture: {
    plan: ConversationActionPlanRow;
    steps: ConversationActionPlanStepRow[];
    receipt: ConversationActionPlanPolicyReceiptRow;
  },
): WorkflowEvent {
  return {
    id: `event_${hashToken(fixture.plan.id).slice(0, 32)}`,
    tenantId: fixture.plan.tenant_id,
    actorId,
    type: "conversation.plan.execute",
    payload: {
      planId: fixture.plan.id,
      planFingerprint: fixture.plan.plan_fingerprint,
      threadId: fixture.plan.thread_id,
      sourceMessageId: fixture.plan.source_message_id,
      policyReceipt: {
        id: fixture.receipt.id,
        fingerprint: fixture.receipt.receipt_fingerprint,
        schemaVersion: 1,
      },
    },
    correlationId: fixture.plan.id,
    causationId: fixture.plan.source_message_id,
    idempotencyKey: `conversation.plan.execute:${fixture.plan.id}`,
  };
}

async function countPolicyReceipts(
  db: TestDb,
  tenantId: string,
  planId: string,
) {
  const result = await db.query<{ count: number }>(
    `select count(*)::int as count
     from conversation_action_plan_policy_receipts
     where tenant_id = $1 and plan_id = $2`,
    [tenantId, planId],
  );
  return result.rows[0]?.count ?? 0;
}

async function expectNoWorkflowWrites(context: TenantContext, planId: string) {
  const result = await context.db.query<{
    events: number;
    runs: number;
    runSteps: number;
  }>(
    `select
       (select count(*)::int from domain_events
        where tenant_id = $1
          and idempotency_key = $2) as events,
       (select count(*)::int from workflow_runs
        where tenant_id = $1 and workflow_key = $3) as runs,
       (select count(*)::int from workflow_run_steps workflow_step
        join workflow_runs workflow_run
          on workflow_run.id = workflow_step.workflow_run_id
          and workflow_run.tenant_id = workflow_step.tenant_id
        where workflow_run.tenant_id = $1
          and workflow_run.workflow_key = $3) as "runSteps"`,
    [
      context.tenantId,
      `conversation.plan.execute:${planId}`,
      `conversation_plan:${planId}`,
    ],
  );
  expect(result.rows[0]).toEqual({ events: 0, runs: 0, runSteps: 0 });
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
    text: "Contenu client confidentiel exclu des preuves de policy.",
    attachments: [],
    occurredAt,
  };
}

function automaticReadOnlyPlanGenerator() {
  return {
    async generate() {
      return {
        generationSource: "deterministic_mock" as const,
        plan: {
          intent: "Vérifier deux correspondances de démonstration",
          businessGoal: "Confirmer les contacts mock sans écriture externe",
          confidence: 0.96,
          missingContextQuestions: [],
          contextSources: [],
          riskSummary: "Deux lectures locales mock à risque faible.",
          estimatedCost: { amount: 0, currency: "EUR" },
          steps: [
            {
              stepId: "search_contact_primary",
              capability: "crm.contacts.search",
              providerPreference: ["tradikom_mock"],
              input: { query: "contact principal" },
              risk: "low" as const,
              requiresApproval: false,
              reversible: true,
              evidenceRequired: ["Nombre de correspondances mock"],
              idempotencyKey: "policy-auto-search-primary",
            },
            {
              stepId: "search_contact_secondary",
              capability: "crm.contacts.search",
              providerPreference: ["tradikom_mock"],
              input: { query: "contact secondaire" },
              risk: "low" as const,
              requiresApproval: false,
              reversible: true,
              evidenceRequired: ["Nombre de correspondances mock"],
              idempotencyKey: "policy-auto-search-secondary",
            },
          ],
          finalUserMessageDraft:
            "Je peux vérifier les deux correspondances en mode mock.",
        },
      };
    },
  };
}
