import { withTenantDbTransaction } from "@/db/tenant-context";
import type { DbClient } from "@/lib/db";
import { hashToken, id, nowIso, safeJson, toJson } from "@/lib/security";
import type { Role } from "@/lib/types";
import { recordAuditLog } from "@/modules/audit";
import {
  findConversationIdentityByExternalSubject,
  findConversationMessageRow,
  insertConversationIdentityIfAbsent,
  insertConversationMessageIfAbsent,
  insertConversationParticipantIfAbsent,
  insertConversationRouteHop,
  insertThreadParticipantIfAbsent,
  listConversationIdentityRows,
  updateConversationThreadLastMessage,
  updateConversationThreadStatus,
} from "@/modules/conversation-hub/repository";
import {
  os1MockCapabilityCatalog,
  validateActionPlan,
} from "@/modules/orchestrator/capabilities";
import { OrchestratorError } from "@/modules/orchestrator/errors";
import {
  createDeterministicActionPlanGenerator,
  type ActionPlanGenerator,
} from "@/modules/orchestrator/generator";
import {
  decideActionPlanRow,
  findActionPlanApproval,
  findActionPlanByFingerprint,
  findActionPlanRow,
  insertActionPlan,
  insertActionPlanApproval,
  insertActionPlanStep,
  listActionPlanRowsByThread,
  listActionPlanStepRows,
  markActionPlanExecuted,
  updateActionPlanApprovalStatus,
  updateActionPlanExecutionStatus,
  updateActionPlanStepStatuses,
  type ConversationActionPlanRow,
} from "@/modules/orchestrator/repository";
import {
  actionPlanCreationSchema,
  actionPlanDecisionSchema,
  actionPlanExecutionSchema,
  actionPlanListSchema,
  actionPlanSchema,
  type ActionPlanCreation,
  type ActionPlanDecision,
} from "@/modules/orchestrator/schemas";
import { assertTenantAccess } from "@/modules/tenants";
import {
  executeWorkflowDefinition,
  findWorkflowRunByKey,
  listWorkflowRunStepRows,
  workflowDefinitionSchema,
} from "@/modules/workflows";

const mockScopes = ["crm.contacts.read", "project.tasks.write"];
const creationRoles: Role[] = [
  "owner",
  "administrator",
  "manager",
  "collaborator",
];
const decisionRoles: Role[] = ["owner", "administrator", "manager"];

export async function createConversationActionPlan(
  db: DbClient,
  userId: string,
  input: ActionPlanCreation,
  dependencies: { generator?: ActionPlanGenerator } = {},
) {
  const parsed = actionPlanCreationSchema.parse(input);
  const source = await withTenantDbTransaction(
    db,
    parsed.tenantId,
    userId,
    async (transaction) => {
      await assertTenantAccess(
        transaction,
        userId,
        parsed.tenantId,
        creationRoles,
      );
      const message = await findConversationMessageRow(
        transaction,
        parsed.tenantId,
        parsed.threadId,
        parsed.sourceMessageId,
      );
      if (!message) {
        throw new OrchestratorError(
          "orchestrator_source_message_not_found",
          "Le message source du plan est introuvable.",
        );
      }
      assertValidSourceMessage(message.direction, message.kind);
      return message;
    },
  );
  const generator =
    dependencies.generator ?? createDeterministicActionPlanGenerator();
  const generated = await generator.generate({
    tenantId: parsed.tenantId,
    threadId: parsed.threadId,
    sourceMessageId: parsed.sourceMessageId,
    sourceText: source.text_content,
  });
  if (
    (generated.generationSource === "model" && !generated.modelReference) ||
    (generated.generationSource === "deterministic_mock" &&
      generated.modelReference)
  ) {
    throw new OrchestratorError(
      "orchestrator_capability_mismatch",
      "La source de génération du plan est incohérente.",
    );
  }

  return withTenantDbTransaction(
    db,
    parsed.tenantId,
    userId,
    async (transaction) => {
      const role = await assertTenantAccess(
        transaction,
        userId,
        parsed.tenantId,
        creationRoles,
      );
      const currentSource = await findConversationMessageRow(
        transaction,
        parsed.tenantId,
        parsed.threadId,
        parsed.sourceMessageId,
      );
      if (!currentSource) {
        throw new OrchestratorError(
          "orchestrator_source_message_not_found",
          "Le message source du plan est introuvable.",
        );
      }
      assertValidSourceMessage(currentSource.direction, currentSource.kind);
      const validated = validateActionPlan(generated.plan, {
        role,
        grantedScopes: mockScopes,
      });
      const planJson = toJson(validated.plan);
      const planFingerprint = hashToken(planJson);
      const existing = await findActionPlanByFingerprint(
        transaction,
        parsed.tenantId,
        parsed.sourceMessageId,
        planFingerprint,
      );
      if (existing) {
        return mapPlanResult(transaction, existing, true);
      }

      const createdAt = nowIso();
      const plan = await insertActionPlan(transaction, {
        id: id("conversation_action_plan"),
        tenantId: parsed.tenantId,
        threadId: parsed.threadId,
        sourceMessageId: parsed.sourceMessageId,
        generationSource: generated.generationSource,
        modelReference: generated.modelReference ?? null,
        approvalStatus:
          validated.approval.mode === "single"
            ? "awaiting_approval"
            : "approved",
        intent: validated.plan.intent,
        businessGoal: validated.plan.businessGoal,
        confidence: validated.plan.confidence,
        riskSummary: validated.plan.riskSummary,
        estimatedCostMinor: Math.round(
          (validated.plan.estimatedCost?.amount ?? 0) * 100,
        ),
        estimatedCostCurrency:
          validated.plan.estimatedCost?.currency ?? "EUR",
        planJson,
        planFingerprint,
        createdBy: userId,
        createdAt,
        decidedBy:
          validated.approval.mode === "none" ? userId : null,
        decidedAt:
          validated.approval.mode === "none" ? createdAt : null,
        decisionReason:
          validated.approval.mode === "none"
            ? "Aucune validation requise selon la politique OS-1."
            : null,
      });
      if (!plan) {
        const concurrent = await findActionPlanByFingerprint(
          transaction,
          parsed.tenantId,
          parsed.sourceMessageId,
          planFingerprint,
        );
        if (!concurrent) {
          throw new OrchestratorError(
            "orchestrator_decision_conflict",
            "Le plan existe déjà mais ne peut pas être relu.",
          );
        }
        return mapPlanResult(transaction, concurrent, true);
      }

      for (const [position, step] of validated.plan.steps.entries()) {
        const capability = os1MockCapabilityCatalog.find(
          (entry) => entry.name === step.capability,
        );
        if (!capability) {
          throw new OrchestratorError(
            "orchestrator_capability_unavailable",
            `La capacité ${step.capability} n'est pas disponible.`,
          );
        }
        await insertActionPlanStep(transaction, {
          tenantId: parsed.tenantId,
          planId: plan.id,
          position,
          stepId: step.stepId,
          capability: step.capability,
          mode: capability.mode,
          risk: step.risk,
          requiresApproval: step.requiresApproval,
          reversible: reversibleValue(step.reversible),
          inputJson: toJson(step.input),
          evidenceRequiredJson: toJson(step.evidenceRequired),
          idempotencyKey: step.idempotencyKey,
        });
      }

      let approvalId: string | undefined;
      if (validated.approval.mode === "single") {
        approvalId = id("approval");
        await insertActionPlanApproval(transaction, {
          id: approvalId,
          tenantId: parsed.tenantId,
          requestedBy: userId,
          planId: plan.id,
          createdAt,
        });
      }
      await appendOrchestratorMessage(transaction, {
        tenantId: parsed.tenantId,
        threadId: parsed.threadId,
        sourceMessageId: parsed.sourceMessageId,
        planId: plan.id,
        kind: "plan",
        text: validated.plan.finalUserMessageDraft,
        correlationId: currentSource.correlation_id,
        createdAt,
      });
      await updateConversationThreadStatus(transaction, {
        tenantId: parsed.tenantId,
        threadId: parsed.threadId,
        status:
          validated.approval.mode === "single"
            ? "awaiting_validation"
            : "open",
        updatedAt: createdAt,
      });
      await recordAuditLog(transaction, {
        tenantId: parsed.tenantId,
        actorId: userId,
        action: "conversation.plan_created",
        targetType: "conversation_action_plan",
        targetId: plan.id,
        metadata: {
          threadId: parsed.threadId,
          sourceMessageId: parsed.sourceMessageId,
          schemaVersion: 1,
          approvalMode: validated.approval.mode,
          capabilityCount: validated.plan.steps.length,
          executionEnvironment: "mock",
          estimatedExternalCost: 0,
        },
      });

      const result = await mapPlanResult(transaction, plan, false);
      return { ...result, approvalId };
    },
  );
}

export async function getConversationActionPlan(
  db: DbClient,
  userId: string,
  tenantId: string,
  planId: string,
) {
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId);
    const plan = await findActionPlanRow(transaction, tenantId, planId);
    if (!plan) {
      throw new OrchestratorError(
        "orchestrator_plan_not_found",
        "Le plan est introuvable.",
      );
    }
    return mapPlanResult(transaction, plan, false);
  });
}

export async function listConversationActionPlans(
  db: DbClient,
  userId: string,
  tenantId: string,
  threadId: string,
) {
  const parsed = actionPlanListSchema.parse({ threadId });
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId);
    const plans = await listActionPlanRowsByThread(
      transaction,
      tenantId,
      parsed.threadId,
    );
    const results = [];
    for (const plan of plans) {
      results.push(await mapPlanResult(transaction, plan, false));
    }
    return results;
  });
}

export async function decideConversationActionPlan(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: ActionPlanDecision,
) {
  const parsed = actionPlanDecisionSchema.parse(input);
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, decisionRoles);
    const existing = await findActionPlanRow(
      transaction,
      tenantId,
      parsed.planId,
    );
    if (!existing) {
      throw new OrchestratorError(
        "orchestrator_plan_not_found",
        "Le plan est introuvable.",
      );
    }
    if (existing.approval_status !== "awaiting_approval") {
      if (existing.approval_status === parsed.decision) {
        const replay = await mapPlanResult(transaction, existing, true);
        return { ...replay, decision: parsed.decision };
      }
      throw new OrchestratorError(
        "orchestrator_decision_conflict",
        "Le plan a déjà reçu une autre décision.",
      );
    }
    const approval = await findActionPlanApproval(
      transaction,
      tenantId,
      existing.id,
    );
    if (!approval || approval.status !== "pending") {
      throw new OrchestratorError(
        "orchestrator_approval_not_found",
        "La validation unique de ce plan est introuvable.",
      );
    }
    const updatedApproval = await updateActionPlanApprovalStatus(
      transaction,
      tenantId,
      approval.id,
      parsed.decision,
    );
    if (!updatedApproval) {
      throw new OrchestratorError(
        "orchestrator_decision_conflict",
        "La validation a déjà été traitée.",
      );
    }
    const decidedAt = nowIso();
    const decided = await decideActionPlanRow(transaction, {
      tenantId,
      planId: existing.id,
      status: parsed.decision,
      decidedBy: userId,
      decidedAt,
      reason: parsed.reason,
    });
    if (!decided) {
      throw new OrchestratorError(
        "orchestrator_decision_conflict",
        "Le plan a déjà été traité.",
      );
    }
    await updateActionPlanStepStatuses(
      transaction,
      tenantId,
      existing.id,
      parsed.decision === "approved" ? "approved" : "cancelled",
    );
    await appendOrchestratorMessage(transaction, {
      tenantId,
      threadId: existing.thread_id,
      sourceMessageId: existing.source_message_id,
      planId: existing.id,
      kind: "approval",
      text: parsed.decision === "approved" ? "Plan approuvé." : "Plan refusé.",
      correlationId: existing.id,
      createdAt: decidedAt,
      decision: parsed.decision,
    });
    await updateConversationThreadStatus(transaction, {
      tenantId,
      threadId: existing.thread_id,
      status: "open",
      updatedAt: decidedAt,
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: `conversation.plan_${parsed.decision}`,
      targetType: "conversation_action_plan",
      targetId: existing.id,
      metadata: {
        threadId: existing.thread_id,
        approvalId: approval.id,
        decision: parsed.decision,
        planFingerprint: existing.plan_fingerprint,
      },
    });
    const result = await mapPlanResult(transaction, decided, false);
    return { ...result, decision: parsed.decision };
  });
}

export async function executeConversationActionPlan(
  db: DbClient,
  userId: string,
  tenantId: string,
  planId: string,
) {
  const parsed = actionPlanExecutionSchema.parse({ planId });
  const outcome = await withTenantDbTransaction(
    db,
    tenantId,
    userId,
    async (transaction) => {
      await assertTenantAccess(transaction, userId, tenantId, decisionRoles);
      const plan = await findActionPlanRow(transaction, tenantId, parsed.planId);
      if (!plan) {
        throw new OrchestratorError(
          "orchestrator_plan_not_found",
          "Le plan est introuvable.",
        );
      }
      const workflowKey = conversationPlanWorkflowKey(plan.id);
      const existingRun = await findWorkflowRunByKey(
        transaction,
        tenantId,
        workflowKey,
      );
      if (plan.approval_status === "executed") {
        if (!existingRun || existingRun.status !== "succeeded") {
          throw new OrchestratorError(
            "orchestrator_execution_failed",
            "La preuve durable de l’exécution est introuvable.",
          );
        }
        return {
          result: await mapExecutionResult(
            transaction,
            plan,
            existingRun,
            true,
          ),
        };
      }
      if (plan.approval_status !== "approved") {
        throw new OrchestratorError(
          "orchestrator_execution_not_approved",
          "Le plan doit être approuvé avant son exécution.",
        );
      }
      const steps = await listActionPlanStepRows(transaction, tenantId, plan.id);
      if (steps.length !== 2) {
        throw new OrchestratorError(
          "orchestrator_execution_failed",
          "Le plan mock OS-1 doit contenir exactement deux étapes.",
        );
      }
      if (existingRun?.status === "failed") {
        return { failure: "mock_workflow_failed" as const };
      }
      await updateActionPlanExecutionStatus(
        transaction,
        tenantId,
        plan.id,
        "running",
      );
      try {
        const runId = existingRun
          ? existingRun.id
          : await executeWorkflowDefinition(
              transaction,
              buildConversationPlanWorkflow(plan, steps),
              {
                id: `event_${hashToken(plan.id).slice(0, 32)}`,
                tenantId,
                actorId: userId,
                type: "conversation.plan.execute",
                payload: {
                  planId: plan.id,
                  planFingerprint: plan.plan_fingerprint,
                  threadId: plan.thread_id,
                  sourceMessageId: plan.source_message_id,
                },
                correlationId: plan.id,
                causationId: plan.source_message_id,
                idempotencyKey: `conversation.plan.execute:${plan.id}`,
              },
            );
        const run = runId
          ? await findWorkflowRunByKey(transaction, tenantId, workflowKey)
          : existingRun ??
            (await findWorkflowRunByKey(transaction, tenantId, workflowKey));
        if (!run || run.status !== "succeeded") {
          throw new Error("mock_workflow_not_succeeded");
        }
        await updateActionPlanExecutionStatus(
          transaction,
          tenantId,
          plan.id,
          "succeeded",
        );
        const executedAt = nowIso();
        const executedPlan = await markActionPlanExecuted(
          transaction,
          tenantId,
          plan.id,
          executedAt,
        );
        if (!executedPlan) {
          throw new Error("plan_execution_state_conflict");
        }
        await appendOrchestratorMessage(transaction, {
          tenantId,
          threadId: plan.thread_id,
          sourceMessageId: plan.source_message_id,
          planId: plan.id,
          kind: "result",
          text: "Exécution mock terminée : contact simulé retrouvé et tâche simulée préparée. Aucun effet externe.",
          correlationId: run.id,
          createdAt: executedAt,
        });
        await updateConversationThreadStatus(transaction, {
          tenantId,
          threadId: plan.thread_id,
          status: "open",
          updatedAt: executedAt,
        });
        await recordAuditLog(transaction, {
          tenantId,
          actorId: userId,
          action: "conversation.plan_executed",
          targetType: "conversation_action_plan",
          targetId: plan.id,
          metadata: {
            threadId: plan.thread_id,
            workflowRunId: run.id,
            planFingerprint: plan.plan_fingerprint,
            executionEnvironment: "mock",
            capabilityCount: steps.length,
            externalSideEffect: false,
          },
        });
        return {
          result: await mapExecutionResult(
            transaction,
            executedPlan,
            run,
            false,
          ),
        };
      } catch {
        await updateActionPlanExecutionStatus(
          transaction,
          tenantId,
          plan.id,
          "failed",
        );
        await recordAuditLog(transaction, {
          tenantId,
          actorId: userId,
          action: "conversation.plan_execution_failed",
          targetType: "conversation_action_plan",
          targetId: plan.id,
          metadata: {
            threadId: plan.thread_id,
            planFingerprint: plan.plan_fingerprint,
            executionEnvironment: "mock",
            safeErrorClassification: "mock_workflow_failed",
          },
        });
        return { failure: "mock_workflow_failed" as const };
      }
    },
  );
  if ("failure" in outcome) {
    throw new OrchestratorError(
      "orchestrator_execution_failed",
      "L’exécution mock a échoué; sa preuve durable est conservée.",
    );
  }
  return outcome.result;
}

async function appendOrchestratorMessage(
  db: DbClient,
  input: {
    tenantId: string;
    threadId: string;
    sourceMessageId: string;
    planId: string;
    kind: "plan" | "approval" | "result";
    text: string;
    correlationId: string;
    createdAt: string;
    decision?: "approved" | "rejected";
  },
) {
  const identity = await ensureOrchestratorIdentity(
    db,
    input.tenantId,
    input.createdAt,
  );
  await insertThreadParticipantIfAbsent(db, {
    tenantId: input.tenantId,
    threadId: input.threadId,
    channelIdentityId: identity.id,
    joinedAt: input.createdAt,
  });
  const discriminator =
    input.decision ?? (input.kind === "result" ? "executed" : "proposal");
  const message = await insertConversationMessageIfAbsent(db, {
    id: id("conversation_message"),
    tenantId: input.tenantId,
    threadId: input.threadId,
    channelIdentityId: identity.id,
    direction: "internal",
    kind: input.kind,
    status: "received",
    textContent: input.text,
    adapterKey: "orchestrator-mock",
    externalMessageId: `${input.planId}:${discriminator}`,
    idempotencyKey: `orchestrator:${input.planId}:${discriminator}`,
    correlationId: input.correlationId,
    causationId: input.sourceMessageId,
    occurredAt: input.createdAt,
    createdAt: input.createdAt,
  });
  if (message) {
    const identities = await listConversationIdentityRows(
      db,
      input.tenantId,
      input.threadId,
    );
    const projectedIdentities = identities
      .filter(
        (candidate) =>
          candidate.id !== identity.id && candidate.state === "active",
      )
      .slice(0, 8);
    for (const [position, target] of projectedIdentities.entries()) {
      await insertConversationRouteHop(db, {
        tenantId: input.tenantId,
        messageId: message.id,
        position,
        adapterKey: target.adapter_key,
        channelIdentityId: target.id,
        externalMessageId: `${input.planId}:${discriminator}:${position}`,
      });
    }
  }
  await updateConversationThreadLastMessage(db, {
    tenantId: input.tenantId,
    threadId: input.threadId,
    occurredAt: input.createdAt,
    updatedAt: input.createdAt,
  });
}

function buildConversationPlanWorkflow(
  plan: ConversationActionPlanRow,
  steps: Awaited<ReturnType<typeof listActionPlanStepRows>>,
) {
  return workflowDefinitionSchema.parse({
    key: conversationPlanWorkflowKey(plan.id),
    version: 1,
    trigger: "conversation.plan.execute",
    active: true,
    conditions: [],
    actions: steps.map((step) => {
      const type =
        step.capability === "crm.contacts.search"
          ? "mock_search_contact"
          : step.capability === "project.task.create"
            ? "mock_create_task"
            : null;
      if (!type) {
        throw new OrchestratorError(
          "orchestrator_capability_unavailable",
          "Une capacité du plan n’est pas exécutable en mock.",
        );
      }
      return {
        type,
        input: { planStepId: step.step_id, capability: step.capability },
        idempotencyKey: step.idempotency_key,
      };
    }),
    retryPolicy: { maxAttempts: 3, backoffMs: 500 },
    timeoutMs: 30_000,
    approvalPolicy: "no_approval_required",
  });
}

function conversationPlanWorkflowKey(planId: string) {
  return `conversation_plan:${planId}`;
}

async function mapExecutionResult(
  db: DbClient,
  plan: ConversationActionPlanRow,
  run: NonNullable<Awaited<ReturnType<typeof findWorkflowRunByKey>>>,
  idempotentReplay: boolean,
) {
  const mappedPlan = await mapPlanResult(db, plan, idempotentReplay);
  const workflowSteps = await listWorkflowRunStepRows(db, plan.tenant_id, [run.id]);
  return {
    ...mappedPlan,
    execution: {
      workflowRunId: run.id,
      status: run.status,
      summary: run.summary,
      environment: "mock" as const,
      externalSideEffect: false as const,
      steps: workflowSteps.map((step) => ({
        action: step.action_name,
        status: step.status,
        attempts: Number(step.attempts),
      })),
    },
  };
}

async function ensureOrchestratorIdentity(
  db: DbClient,
  tenantId: string,
  createdAt: string,
) {
  const adapterKey = "orchestrator-mock";
  const externalSubjectId = "tradikom-one-orchestrator";
  const existing = await findConversationIdentityByExternalSubject(
    db,
    tenantId,
    adapterKey,
    externalSubjectId,
  );
  if (existing) {
    if (existing.state !== "active") {
      throw new OrchestratorError(
        "orchestrator_decision_conflict",
        "L'identité interne de l'orchestrateur est indisponible.",
      );
    }
    return existing;
  }

  const fingerprint = hashToken(tenantId).slice(0, 32);
  const participantId = `orchestrator_participant_${fingerprint}`;
  const identityId = `orchestrator_identity_${fingerprint}`;
  await insertConversationParticipantIfAbsent(db, {
    id: participantId,
    tenantId,
    role: "system",
    displayName: "TRADIKOM ONE",
    createdAt,
    updatedAt: createdAt,
  });
  await insertConversationIdentityIfAbsent(db, {
    id: identityId,
    tenantId,
    participantId,
    channelKind: "test",
    adapterKey,
    externalSubjectId,
    displayName: "TRADIKOM ONE",
    role: "system",
    state: "active",
    createdAt,
    updatedAt: createdAt,
  });
  const inserted = await findConversationIdentityByExternalSubject(
    db,
    tenantId,
    adapterKey,
    externalSubjectId,
  );
  if (!inserted) {
    throw new OrchestratorError(
      "orchestrator_decision_conflict",
      "L'identité interne de l'orchestrateur ne peut pas être créée.",
    );
  }
  return inserted;
}

async function mapPlanResult(
  db: DbClient,
  plan: ConversationActionPlanRow,
  idempotentReplay: boolean,
) {
  const steps = await listActionPlanStepRows(db, plan.tenant_id, plan.id);
  const approval = await findActionPlanApproval(db, plan.tenant_id, plan.id);
  return {
    id: plan.id,
    tenantId: plan.tenant_id,
    threadId: plan.thread_id,
    sourceMessageId: plan.source_message_id,
    schemaVersion: plan.schema_version,
    generationSource: plan.generation_source,
    modelReference: plan.model_reference ?? undefined,
    approvalStatus: plan.approval_status,
    plan: actionPlanSchema.parse(safeJson(plan.plan_json, {})),
    planFingerprint: plan.plan_fingerprint,
    approvalId: approval?.id,
    createdAt: plan.created_at,
    updatedAt: plan.updated_at,
    decidedAt: plan.decided_at ?? undefined,
    decisionReason: plan.decision_reason ?? undefined,
    idempotentReplay,
    steps: steps.map((step) => ({
      stepId: step.step_id,
      capability: step.capability,
      status: step.status,
      idempotencyKey: step.idempotency_key,
    })),
  };
}

function reversibleValue(value: boolean | "compensation_only") {
  if (value === "compensation_only") return value;
  return value ? ("true" as const) : ("false" as const);
}

function assertValidSourceMessage(direction: string, kind: string) {
  if (direction !== "inbound" || kind !== "text") {
    throw new OrchestratorError(
      "orchestrator_source_message_invalid",
      "Seul un message texte entrant peut ouvrir un plan.",
    );
  }
}
