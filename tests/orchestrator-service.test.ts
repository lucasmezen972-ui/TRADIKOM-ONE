import { afterEach, describe, expect, it, vi } from "vitest";
import { createMemoryDb, type DbClient } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import {
  configureConversationThreadAccess,
  ingestConversationMessage,
} from "../src/modules/conversation-hub";
import {
  createConversationActionPlan,
  decideConversationActionPlan,
  executeConversationActionPlan,
  getConversationActionPlan,
  listConversationActionPlans,
  requestConversationActionPlanRetry,
} from "../src/modules/orchestrator";
import {
  cancelWorkflowQueueEvent,
  getWorkflowDeadLetters,
  getWorkflowQueueOverview,
  getWorkflowRuns,
  requestManualWorkflowRetry,
  retryWorkflowDeadLetter,
} from "../src/modules/workflows";
import { processPendingDomainEvents } from "../src/modules/workflows/worker";

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
    const listed = await listConversationActionPlans(
      context.db,
      context.userId,
      context.tenantId,
      source.threadId,
    );
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      id: created.id,
      tenantId: context.tenantId,
      threadId: source.threadId,
    });

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

  it("exécute les deux capacités mock durablement et projette un résultat multicanal", async () => {
    const context = await createTenantContext("execution-owner@example.com");
    const source = await ingestConversationMessage(
      context.db,
      context.userId,
      ingressFixture(context.tenantId),
    );
    await ingestConversationMessage(context.db, context.userId, {
      ...testChannelIngressFixture(context.tenantId),
      threadId: source.threadId,
    });
    const plan = await createConversationActionPlan(
      context.db,
      context.userId,
      {
        tenantId: context.tenantId,
        threadId: source.threadId,
        sourceMessageId: source.messageId,
      },
    );
    await expect(
      executeConversationActionPlan(
        context.db,
        context.userId,
        context.tenantId,
        plan.id,
      ),
    ).rejects.toMatchObject({ code: "orchestrator_execution_not_approved" });
    await decideConversationActionPlan(
      context.db,
      context.userId,
      context.tenantId,
      {
        planId: plan.id,
        decision: "approved",
        reason: "Plan mock vérifié avant exécution.",
      },
    );
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Aucun transport externe attendu."));

    const executed = await executeConversationActionPlan(
      context.db,
      context.userId,
      context.tenantId,
      plan.id,
    );
    const replay = await executeConversationActionPlan(
      context.db,
      context.userId,
      context.tenantId,
      plan.id,
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(executed).toMatchObject({
      id: plan.id,
      approvalStatus: "executed",
      idempotentReplay: false,
      steps: [{ status: "succeeded" }, { status: "succeeded" }],
      execution: {
        status: "succeeded",
        environment: "mock",
        externalSideEffect: false,
        steps: [
          { action: "mock_search_contact", status: "succeeded", attempts: 1 },
          { action: "mock_create_task", status: "succeeded", attempts: 1 },
        ],
      },
    });
    expect(replay).toMatchObject({
      id: plan.id,
      approvalStatus: "executed",
      idempotentReplay: true,
      execution: { workflowRunId: executed.execution.workflowRunId },
    });
    expect(executed.execution.steps).toEqual([
      expect.objectContaining({
        evidence: expect.objectContaining({
          capability: "crm.contacts.search",
          providerKey: "tradikom_mock",
          executionEnvironment: "mock",
          output: { matchCount: 1 },
          externalSideEffect: false,
          inputStored: false,
        }),
      }),
      expect.objectContaining({
        evidence: expect.objectContaining({
          capability: "project.task.create",
          providerKey: "tradikom_mock",
          executionEnvironment: "mock",
          output: {
            taskReference: expect.stringMatching(/^tache_mock_[a-f0-9]{24}$/),
          },
          compensation: {
            available: true,
            capability: "project.task.archive",
          },
          externalSideEffect: false,
          inputStored: false,
        }),
      }),
    ]);

    const counts = await context.db.query<{
      runs: number;
      steps: number;
      events: number;
      tasks: number;
      results: number;
    }>(
      `select
         (select count(*)::int from workflow_runs where tenant_id = $1
           and workflow_key = $2) as runs,
         (select count(*)::int from workflow_run_steps where tenant_id = $1) as steps,
         (select count(*)::int from domain_events where tenant_id = $1
           and idempotency_key = $3) as events,
         (select count(*)::int from tasks where tenant_id = $1) as tasks,
         (select count(*)::int from conversation_messages where tenant_id = $1
           and thread_id = $4 and kind = 'result') as results`,
      [
        context.tenantId,
        `conversation_plan:${plan.id}`,
        `conversation.plan.execute:${plan.id}`,
        source.threadId,
      ],
    );
    expect(counts.rows[0]).toEqual({
      runs: 1,
      steps: 2,
      events: 1,
      tasks: 0,
      results: 1,
    });

    const resultRoutes = await context.db.query<{ adapter_key: string }>(
      `select routes.adapter_key
       from conversation_message_route_hops as routes
       join conversation_messages as messages
         on messages.tenant_id = routes.tenant_id and messages.id = routes.message_id
       where routes.tenant_id = $1 and messages.thread_id = $2
         and messages.kind = 'result'
       order by routes.position`,
      [context.tenantId, source.threadId],
    );
    expect(resultRoutes.rows.map((row) => row.adapter_key)).toEqual([
      "web-chat",
      "test-channel",
    ]);

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
      "conversation.plan_executed",
    ]);
    expect(audit.rows[2]?.safe_metadata).toContain('"externalSideEffect":false');
    expect(audit.rows[2]?.safe_metadata).not.toContain(
      "Plan mock vérifié avant exécution",
    );
    const stepEvidence = await context.db.query<{ safe_metadata: string }>(
      `select safe_metadata from workflow_run_steps
       where tenant_id = $1 order by created_at asc, id asc`,
      [context.tenantId],
    );
    expect(stepEvidence.rows).toHaveLength(2);
    expect(stepEvidence.rows[0]?.safe_metadata).toContain("tradikom_mock");
    expect(stepEvidence.rows[1]?.safe_metadata).toContain("project.task.archive");
    expect(stepEvidence.rows.map((row) => row.safe_metadata).join(" ")).not.toContain(
      "Relancer le contact de la conversation",
    );
  });

  it("finalise une reprise worker dans le fil sans second clic d'exécution", async () => {
    const context = await createTenantContext("resume-plan-owner@example.com");
    const source = await ingestConversationMessage(
      context.db,
      context.userId,
      ingressFixture(context.tenantId),
    );
    await ingestConversationMessage(context.db, context.userId, {
      ...testChannelIngressFixture(context.tenantId),
      threadId: source.threadId,
    });
    const plan = await createConversationActionPlan(
      context.db,
      context.userId,
      {
        tenantId: context.tenantId,
        threadId: source.threadId,
        sourceMessageId: source.messageId,
      },
    );
    await decideConversationActionPlan(
      context.db,
      context.userId,
      context.tenantId,
      {
        planId: plan.id,
        decision: "approved",
        reason: "Reprise durable autorisée.",
      },
    );
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockRejectedValue(new Error("Aucun transport externe attendu."));

    let interruptionInjected = false;
    const interruptedDb: DbClient = {
      query: async <T>(sql: string, params?: unknown[]) => {
        if (
          !interruptionInjected &&
          sql.includes("insert into workflow_run_steps") &&
          params?.[4] === "succeeded" &&
          String(params?.[5]).includes('"actionIndex":1')
        ) {
          interruptionInjected = true;
          throw new Error("Interruption simulée avant la preuve de la seconde étape.");
        }
        return context.db.query<T>(sql, params);
      },
    };

    await expect(
      executeConversationActionPlan(
        interruptedDb,
        context.userId,
        context.tenantId,
        plan.id,
      ),
    ).rejects.toMatchObject({ code: "orchestrator_execution_failed" });
    const interrupted = await getConversationActionPlan(
      context.db,
      context.userId,
      context.tenantId,
      plan.id,
    );
    expect(interrupted).toMatchObject({
      approvalStatus: "approved",
      steps: [{ status: "failed" }, { status: "failed" }],
      mission: { status: "failed" },
    });

    const firstSignal = await requestConversationActionPlanRetry(
      context.db,
      context.userId,
      context.tenantId,
      plan.id,
    );
    const replayedSignal = await requestConversationActionPlanRetry(
      context.db,
      context.userId,
      context.tenantId,
      plan.id,
    );
    expect(firstSignal).toEqual({ idempotentReplay: false });
    expect(replayedSignal).toEqual({ idempotentReplay: true });

    const worker = await processPendingDomainEvents(context.db, {
      now: new Date("2999-01-01T00:00:00.000Z"),
    });
    expect(worker).toMatchObject({ succeeded: 1, failed: 0 });

    const finalized = await getConversationActionPlan(
      context.db,
      context.userId,
      context.tenantId,
      plan.id,
    );
    expect(finalized).toMatchObject({
      approvalStatus: "executed",
      steps: [{ status: "succeeded" }, { status: "succeeded" }],
      mission: { status: "succeeded" },
    });

    const evidence = await context.db.query<{
      action_name: string;
      status: string;
      attempts: number;
    }>(
      `select action_name, status, attempts
       from workflow_run_steps
       where tenant_id = $1
         and action_name in ('mock_search_contact', 'mock_create_task')
       order by created_at asc, id asc`,
      [context.tenantId],
    );
    expect(evidence.rows).toMatchObject([
      { action_name: "mock_search_contact", status: "succeeded", attempts: 1 },
      { action_name: "mock_create_task", status: "failed", attempts: 1 },
      { action_name: "mock_create_task", status: "succeeded", attempts: 2 },
    ]);
    expect(
      evidence.rows.filter(
        (step) =>
          step.action_name === "mock_search_contact" &&
          step.status === "succeeded",
      ),
    ).toHaveLength(1);

    const projection = await context.db.query<{
      results: number;
      routes: number;
      planAudits: number;
      retryAudits: number;
    }>(
      `select
         (select count(*)::int from conversation_messages
          where tenant_id = $1 and thread_id = $2 and kind = 'result') as results,
         (select count(*)::int
          from conversation_message_route_hops as routes
          join conversation_messages as messages
            on messages.tenant_id = routes.tenant_id
           and messages.id = routes.message_id
          where messages.tenant_id = $1 and messages.thread_id = $2
            and messages.kind = 'result') as routes,
         (select count(*)::int from audit_logs
          where tenant_id = $1 and action = 'conversation.plan_executed'
            and target_id = $3) as "planAudits",
         (select count(*)::int from audit_logs
          where tenant_id = $1 and action = 'workflow.manual_retry_requested') as "retryAudits"`,
      [context.tenantId, source.threadId, plan.id],
    );
    expect(projection.rows[0]).toEqual({
      results: 1,
      routes: 2,
      planAudits: 1,
      retryAudits: 1,
    });

    const finalAudit = await context.db.query<{ safe_metadata: string }>(
      `select safe_metadata from audit_logs
       where tenant_id = $1 and action = 'conversation.plan_executed'
         and target_id = $2`,
      [context.tenantId, plan.id],
    );
    expect(finalAudit.rows[0]?.safe_metadata).toContain(
      '"externalSideEffect":false',
    );
    expect(finalAudit.rows[0]?.safe_metadata).not.toContain(
      "Relancer le contact de la conversation",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("ferme les plans quand le droit du fil manque ou est révoqué", async () => {
    const owner = await createTenantContext("thread-plan-owner@example.com");
    const manager = await createSecondUserAndTenant(
      owner.db,
      "thread-plan-manager@example.com",
    );
    await owner.db.query(
      `insert into memberships (tenant_id, user_id, role, created_at)
       values ($1, $2, 'manager', $3)`,
      [owner.tenantId, manager.userId, occurredAt],
    );
    const source = await ingestConversationMessage(
      owner.db,
      owner.userId,
      ingressFixture(owner.tenantId),
    );
    await configureConversationThreadAccess(owner.db, owner.userId, {
      tenantId: owner.tenantId,
      threadId: source.threadId,
      visibilityScope: "team",
      grantedUserIds: [owner.userId],
      idempotencyKey: `thread-plan-access:${source.threadId}:owner`,
    });

    const generator = {
      generate: vi.fn(async () => {
        throw new Error("Le générateur ne doit pas voir un fil inaccessible.");
      }),
    };
    await expect(
      createConversationActionPlan(
        owner.db,
        manager.userId,
        {
          tenantId: owner.tenantId,
          threadId: source.threadId,
          sourceMessageId: source.messageId,
        },
        { generator },
      ),
    ).rejects.toMatchObject({
      code: "orchestrator_source_message_not_found",
    });
    expect(generator.generate).not.toHaveBeenCalled();

    await configureConversationThreadAccess(owner.db, owner.userId, {
      tenantId: owner.tenantId,
      threadId: source.threadId,
      visibilityScope: "team",
      grantedUserIds: [owner.userId, manager.userId],
      idempotencyKey: `thread-plan-access:${source.threadId}:manager`,
    });
    const plan = await createConversationActionPlan(
      owner.db,
      manager.userId,
      {
        tenantId: owner.tenantId,
        threadId: source.threadId,
        sourceMessageId: source.messageId,
      },
    );
    await expect(
      getConversationActionPlan(
        owner.db,
        manager.userId,
        owner.tenantId,
        plan.id,
      ),
    ).resolves.toMatchObject({ id: plan.id });
    await expect(
      listConversationActionPlans(
        owner.db,
        manager.userId,
        owner.tenantId,
        source.threadId,
      ),
    ).resolves.toHaveLength(1);

    await configureConversationThreadAccess(owner.db, owner.userId, {
      tenantId: owner.tenantId,
      threadId: source.threadId,
      visibilityScope: "team",
      grantedUserIds: [owner.userId],
      idempotencyKey: `thread-plan-access:${source.threadId}:revoked`,
    });
    await expect(
      getConversationActionPlan(
        owner.db,
        manager.userId,
        owner.tenantId,
        plan.id,
      ),
    ).rejects.toMatchObject({ code: "orchestrator_plan_not_found" });
    await expect(
      listConversationActionPlans(
        owner.db,
        manager.userId,
        owner.tenantId,
        source.threadId,
      ),
    ).rejects.toMatchObject({ code: "orchestrator_plan_not_found" });
    await expect(
      decideConversationActionPlan(
        owner.db,
        manager.userId,
        owner.tenantId,
        {
          planId: plan.id,
          decision: "approved",
          reason: "Cette décision ne doit pas être enregistrée.",
        },
      ),
    ).rejects.toMatchObject({ code: "orchestrator_plan_not_found" });
    await expect(
      executeConversationActionPlan(
        owner.db,
        manager.userId,
        owner.tenantId,
        plan.id,
      ),
    ).rejects.toMatchObject({ code: "orchestrator_plan_not_found" });

    const state = await owner.db.query<{
      approvalStatus: string;
      approval: string;
      runs: number;
      decisionAudits: number;
    }>(
      `select
         (select approval_status from conversation_action_plans
          where tenant_id = $1 and id = $2) as "approvalStatus",
         (select status from approvals
          where tenant_id = $1 and target_type = 'conversation_action_plan'
            and target_id = $2) as approval,
         (select count(*)::int from workflow_runs
          where tenant_id = $1 and workflow_key = $3) as runs,
         (select count(*)::int from audit_logs
          where tenant_id = $1 and target_id = $2
            and action in ('conversation.plan_approved',
                           'conversation.plan_rejected')) as "decisionAudits"`,
      [owner.tenantId, plan.id, `conversation_plan:${plan.id}`],
    );
    expect(state.rows[0]).toEqual({
      approvalStatus: "awaiting_approval",
      approval: "pending",
      runs: 0,
      decisionAudits: 0,
    });
    const auditText = await owner.db.query<{ safe_metadata: string }>(
      `select safe_metadata from audit_logs where tenant_id = $1`,
      [owner.tenantId],
    );
    expect(auditText.rows.map((row) => row.safe_metadata).join(" ")).not.toContain(
      manager.userId,
    );
  });

  it("revalide le droit dans la transaction qui relance la mission", async () => {
    const context = await createTenantContext("retry-access-owner@example.com");
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
    await decideConversationActionPlan(
      context.db,
      context.userId,
      context.tenantId,
      {
        planId: plan.id,
        decision: "approved",
        reason: "Créer une mission interrompue pour tester sa reprise.",
      },
    );

    let interruptionInjected = false;
    const interruptedDb: DbClient = {
      query: async <T>(sql: string, params?: unknown[]) => {
        if (
          !interruptionInjected &&
          sql.includes("insert into workflow_run_steps") &&
          params?.[4] === "succeeded" &&
          String(params?.[5]).includes('"actionIndex":1')
        ) {
          interruptionInjected = true;
          throw new Error("Interruption simulée avant la seconde preuve.");
        }
        return context.db.query<T>(sql, params);
      },
    };
    await expect(
      executeConversationActionPlan(
        interruptedDb,
        context.userId,
        context.tenantId,
        plan.id,
      ),
    ).rejects.toMatchObject({ code: "orchestrator_execution_failed" });
    await configureConversationThreadAccess(context.db, context.userId, {
      tenantId: context.tenantId,
      threadId: source.threadId,
      visibilityScope: "team",
      grantedUserIds: [context.userId],
      idempotencyKey: `retry-access:${source.threadId}:granted`,
    });
    const beforeRetry = await context.db.query<{
      id: string;
      retryCount: number;
    }>(
      `select id, retry_count::int as "retryCount"
       from workflow_runs where tenant_id = $1 and workflow_key = $2`,
      [context.tenantId, `conversation_plan:${plan.id}`],
    );

    let revocationApplied = false;
    const revokingDb: DbClient = {
      query: async <T>(sql: string, params?: unknown[]) => {
        const result = await context.db.query<T>(sql, params);
        if (!revocationApplied && sql.trim().toLowerCase() === "commit") {
          revocationApplied = true;
          await context.db.query(
            `delete from conversation_thread_access_grants
             where tenant_id = $1 and thread_id = $2 and user_id = $3`,
            [context.tenantId, source.threadId, context.userId],
          );
        }
        return result;
      },
    };
    await expect(
      requestConversationActionPlanRetry(
        revokingDb,
        context.userId,
        context.tenantId,
        plan.id,
      ),
    ).rejects.toMatchObject({ code: "orchestrator_plan_not_found" });
    expect(revocationApplied).toBe(true);
    await expect(
      requestManualWorkflowRetry(
        context.db,
        context.userId,
        context.tenantId,
        { runId: beforeRetry.rows[0]!.id },
      ),
    ).rejects.toMatchObject({ code: "workflow_run_not_found" });
    const visibleRuns = await getWorkflowRuns(
      context.db,
      context.userId,
      context.tenantId,
    );
    expect(visibleRuns.map((run) => run.id)).not.toContain(
      beforeRetry.rows[0]!.id,
    );

    const retryState = await context.db.query<{
      status: string;
      retryCount: number;
      retryEvents: number;
      retryAudits: number;
    }>(
      `select
         (select status from workflow_runs where tenant_id = $1
            and workflow_key = $2) as status,
         (select retry_count::int from workflow_runs where tenant_id = $1
            and workflow_key = $2) as "retryCount",
         (select count(*)::int from domain_events where tenant_id = $1
            and event_type = 'workflow.resume') as "retryEvents",
         (select count(*)::int from audit_logs where tenant_id = $1
            and action = 'workflow.manual_retry_requested') as "retryAudits"`,
      [context.tenantId, `conversation_plan:${plan.id}`],
    );
    expect(retryState.rows[0]).toEqual({
      status: "failed",
      retryCount: beforeRetry.rows[0]?.retryCount,
      retryEvents: 0,
      retryAudits: 0,
    });

    const failedPlanEvent = await context.db.query<{
      id: string;
      attempts: number;
    }>(
      `select id, attempts from domain_events
       where tenant_id = $1 and event_type = 'conversation.plan.execute'`,
      [context.tenantId],
    );
    await context.db.query(
      `insert into domain_events (
         id, tenant_id, actor_id, event_type, payload, status, attempts,
         idempotency_key, correlation_id, causation_id, next_run_at,
         last_error, created_at, updated_at
       ) values ($1, $2, $3, $4, $5, 'pending', 0, $6, $7, null, $8, null, $8, $8),
                ($9, $2, $3, $10, $11, 'pending', 0, $12, $13, null, $8, null, $8, $8)`,
      [
        "event_restricted_resume",
        context.tenantId,
        context.userId,
        "workflow.resume",
        JSON.stringify({
          runId: beforeRetry.rows[0]!.id,
          sourceEventId: failedPlanEvent.rows[0]!.id,
          resumeFromActionIndex: 1,
          reason: "manual_retry",
        }),
        "restricted-resume-event",
        "restricted-resume-correlation",
        "2026-07-30T10:10:00.000Z",
        "event_generic_visible",
        "lead.created",
        JSON.stringify({ leadId: "lead_visible" }),
        "generic-visible-event",
        "generic-visible-correlation",
      ],
    );
    for (let index = 0; index < 12; index += 1) {
      const eventId = `event_restricted_resume_${index}`;
      const createdAt = `2026-07-30T10:00:${String(index).padStart(2, "0")}.000Z`;
      await context.db.query(
        `insert into domain_events (
           id, tenant_id, actor_id, event_type, payload, status, attempts,
           idempotency_key, correlation_id, causation_id, next_run_at,
           last_error, created_at, updated_at
         ) values ($1, $2, $3, 'workflow.resume', $4, 'pending', 0, $5, $6,
                   null, $7, null, $7, $7)`,
        [
          eventId,
          context.tenantId,
          context.userId,
          JSON.stringify({
            runId: beforeRetry.rows[0]!.id,
            sourceEventId: failedPlanEvent.rows[0]!.id,
            resumeFromActionIndex: 1,
            reason: "manual_retry",
          }),
          `restricted-resume-event-${index}`,
          `restricted-resume-correlation-${index}`,
          createdAt,
        ],
      );
    }
    const queue = await getWorkflowQueueOverview(
      context.db,
      context.userId,
      context.tenantId,
    );
    expect(queue.activeEvents.map((event) => event.id)).toEqual([
      "event_generic_visible",
    ]);
    expect(queue.activeEvents[0]).not.toHaveProperty("payload");
    expect(
      queue.summary.find((item) => item.status === "pending")?.count,
    ).toBe(14);
    await expect(
      cancelWorkflowQueueEvent(
        context.db,
        context.userId,
        context.tenantId,
        { eventId: "event_restricted_resume" },
      ),
    ).rejects.toMatchObject({ code: "workflow_queue_event_not_found" });
    const deadLetters = await getWorkflowDeadLetters(
      context.db,
      context.userId,
      context.tenantId,
    );
    expect(deadLetters).toEqual([]);
    await expect(
      retryWorkflowDeadLetter(
        context.db,
        context.userId,
        context.tenantId,
        { eventId: failedPlanEvent.rows[0]!.id },
      ),
    ).rejects.toMatchObject({ code: "workflow_dead_letter_not_found" });

    const protectedEvents = await context.db.query<{
      id: string;
      status: string;
      attempts: number;
    }>(
      `select id, status, attempts from domain_events
       where tenant_id = $1 and id in ($2, $3)
       order by id asc`,
      [
        context.tenantId,
        failedPlanEvent.rows[0]!.id,
        "event_restricted_resume",
      ],
    );
    expect(protectedEvents.rows).toEqual(
      expect.arrayContaining([
        {
          id: "event_restricted_resume",
          status: "pending",
          attempts: 0,
        },
        {
          id: failedPlanEvent.rows[0]!.id,
          status: "failed",
          attempts: failedPlanEvent.rows[0]!.attempts,
        },
      ]),
    );
    const controlAudits = await context.db.query<{ count: number }>(
      `select count(*)::int as count from audit_logs
       where tenant_id = $1 and action in (
         'workflow.queue_event_cancelled',
         'workflow.dead_letter_retried'
       )`,
      [context.tenantId],
    );
    expect(controlAudits.rows[0]?.count).toBe(0);
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
    await expect(
      listConversationActionPlans(
        ownerA.db,
        ownerB.userId,
        ownerA.tenantId,
        source.threadId,
      ),
    ).rejects.toMatchObject({ code: "tenant_access_denied" });

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
    await expect(
      executeConversationActionPlan(
        ownerA.db,
        ownerB.userId,
        ownerA.tenantId,
        plan.id,
      ),
    ).rejects.toMatchObject({ code: "tenant_access_denied" });
    await expect(
      requestConversationActionPlanRetry(
        ownerA.db,
        ownerB.userId,
        ownerA.tenantId,
        plan.id,
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

function testChannelIngressFixture(tenantId: string) {
  return {
    tenantId,
    channelIdentity: {
      id: `test_identity_${tenantId}`,
      tenantId,
      participantId: `test_participant_${tenantId}`,
      channelKind: "test" as const,
      adapterKey: "test-channel",
      externalSubjectId: `test_member_${tenantId}`,
      displayName: "Canal de test",
      role: "member" as const,
      state: "active" as const,
      createdAt: occurredAt,
      updatedAt: occurredAt,
    },
    externalMessageId: `test_external_${tenantId}`,
    idempotencyKey: `ingress:test:${tenantId}`,
    correlationId: `test_correlation_${tenantId}`,
    routeTrace: [],
    text: "Confirmation simulée depuis le second canal.",
    attachments: [],
    occurredAt,
  };
}
