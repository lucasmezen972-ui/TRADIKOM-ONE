import { randomUUID } from "node:crypto";
import {
  withSystemDbTransaction,
  withTenantDbTransaction,
  withTenantSystemDbTransaction,
} from "@/db/tenant-context";
import type { DbClient } from "@/lib/db";
import { hashToken, id, nowIso, safeJson, toJson } from "@/lib/security";
import type { Role } from "@/lib/types";
import {
  listAuditLogRowsByActionAndTarget,
  recordAuditLog,
} from "@/modules/audit";
import {
  prepareExternalUntrustedDataView,
  readExternalUntrustedDataExtraction,
} from "@/modules/conversation-hub/external-untrusted-data";
import {
  findAccessibleConversationThreadRow,
  findConversationIdentityByExternalSubject,
  findConversationMessageByIdempotencyKey,
  findConversationMessageRow,
  insertConversationIdentityIfAbsent,
  insertConversationMessageIfAbsent,
  insertConversationParticipantIfAbsent,
  insertConversationRouteHop,
  insertThreadParticipantIfAbsent,
  listConversationAttachmentRows,
  listConversationIdentityRows,
  updateConversationThreadLastMessage,
  updateConversationThreadStatus,
  type ConversationMessageRow,
} from "@/modules/conversation-hub/repository";
import {
  os1MockCapabilityCatalog,
  validateActionPlan,
} from "@/modules/orchestrator/capabilities";
import { OrchestratorError } from "@/modules/orchestrator/errors";
import {
  assertGeneratedActionPlanDoesNotCopyExternalContext,
  boundActionPlanGenerationContextSources,
  createDeterministicActionPlanGenerator,
  toActionPlanContextSourceMetadata,
  type ActionPlanGenerationContextSource,
  type ActionPlanGenerator,
} from "@/modules/orchestrator/generator";
import {
  findConversationActionPlanPolicyReceiptByPlan,
  decideActionPlanRow,
  findActionPlanApproval,
  findActionPlanByFingerprint,
  findActionPlanRow,
  insertActionPlan,
  insertActionPlanApproval,
  insertConversationActionPlanPolicyReceipt,
  insertActionPlanStep,
  listActionPlanRowsByThread,
  listActionPlanStepRows,
  lockActionPlanRow,
  markActionPlanExecuted,
  updateActionPlanApprovalStatus,
  updateActionPlanExecutionStatus,
  updateActionPlanStepStatusByPosition,
  updateActionPlanStepStatuses,
  type ConversationActionPlanRow,
} from "@/modules/orchestrator/repository";
import {
  compileConversationActionPlanPolicyReceipt,
  conversationActionPlanPolicyReceiptSchemaVersion,
  type ConversationActionPlanPolicyApproval,
} from "@/modules/orchestrator/policy";
import {
  assertConversationActionPlanPolicyReceipt,
  conversationActionPlanGrantedScopes,
  type ConversationActionPlanPolicyEvidence,
  type VerifiedConversationActionPlanPolicy,
} from "@/modules/orchestrator/policy-enforcement";
import {
  actionPlanCreationSchema,
  actionPlanDecisionSchema,
  actionPlanExecutionSchema,
  actionPlanListSchema,
  actionPlanSchema,
  generatedActionPlanEnvelopeSchema,
  type ActionPlanCreation,
  type ActionPlanDecision,
  type ValidatedActionPlan,
} from "@/modules/orchestrator/schemas";
import { assertTenantAccess } from "@/modules/tenants";
import {
  buildConversationPlanWorkflow,
  conversationPlanWorkflowActionType,
  conversationActionPlanWorkflowKey,
} from "@/modules/orchestrator/workflow-plan";
import {
  executeWorkflowDefinition,
  findDomainEventById,
  findWorkflowRunById,
  findWorkflowRunByKey,
  listWorkflowRunStepRows,
  requestManualWorkflowRetry,
  workflowDefinitionSchema,
  WorkflowError,
} from "@/modules/workflows";

const creationRoles: Role[] = [
  "owner",
  "administrator",
  "manager",
  "collaborator",
];
const decisionRoles: Role[] = ["owner", "administrator", "manager"];
const conversationActionPlanResultText =
  "Exécution mock terminée : toutes les étapes simulées ont été vérifiées. Aucun effet externe.";

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
      return readConversationPlanGenerationSource(
        transaction,
        userId,
        parsed.tenantId,
        parsed.threadId,
        parsed.sourceMessageId,
      );
    },
  );
  const generator =
    dependencies.generator ?? createDeterministicActionPlanGenerator();
  const generationContextSources = Object.freeze(
    source.contextSources.map((contextSource) =>
      Object.freeze({ ...contextSource }),
    ),
  );
  const generatedResult = generatedActionPlanEnvelopeSchema.safeParse(
    await generator.generate({
      tenantId: parsed.tenantId,
      threadId: parsed.threadId,
      sourceMessageId: parsed.sourceMessageId,
      sourceText: source.message.text_content,
      contextSources: generationContextSources,
    }),
  );
  if (!generatedResult.success) {
    throw unsafeGeneratedPlanContractError();
  }
  const generated = generatedResult.data;
  const generationMetadata = normalizeGeneratedPlanMetadata(
    generated.generationSource,
    generated.modelReference,
  );
  const generatedPlanResult = actionPlanSchema.safeParse(generated.plan);
  if (!generatedPlanResult.success) {
    throw unsafeGeneratedPlanContractError();
  }
  const authoritativePlanResult = actionPlanSchema.safeParse({
    ...generatedPlanResult.data,
    contextSources: generationContextSources.map(
      toActionPlanContextSourceMetadata,
    ),
  });
  if (!authoritativePlanResult.success) {
    throw unsafeGeneratedPlanContractError();
  }
  const validatedGeneratedPlan = authoritativePlanResult.data;
  const initialGeneratedPlan = cloneValidatedActionPlan(
    validatedGeneratedPlan,
  );
  const generatedByBuiltInServerTemplate =
    dependencies.generator === undefined &&
    generationMetadata.generationSource === "deterministic_mock";
  if (!generatedByBuiltInServerTemplate) {
    assertGeneratedActionPlanDoesNotCopyExternalContext(
      initialGeneratedPlan,
      generationContextSources,
      generationMetadata.modelReference
        ? [generationMetadata.modelReference]
        : [],
    );
  }

  return withTenantSystemDbTransaction(
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
      const currentSource = await readConversationPlanGenerationSource(
        transaction,
        userId,
        parsed.tenantId,
        parsed.threadId,
        parsed.sourceMessageId,
        { lockForUpdate: true },
      );
      if (currentSource.fingerprint !== source.fingerprint) {
        throw new OrchestratorError(
          "orchestrator_source_context_changed",
          "Le contexte du message a changé pendant la préparation du plan.",
        );
      }
      const generatedPlan = {
        ...initialGeneratedPlan,
        contextSources: currentSource.contextSources.map(
          toActionPlanContextSourceMetadata,
        ),
      };
      const validated = validateActionPlan(generatedPlan, {
        role,
        grantedScopes: [...conversationActionPlanGrantedScopes],
      });
      const planJson = serializeActionPlanForPersistence(validated.plan);
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
        generationSource: generationMetadata.generationSource,
        modelReference: generationMetadata.modelReference,
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
      const policyReceipt =
        validated.approval.mode === "none"
          ? await issueConversationActionPlanPolicyReceipt(transaction, {
              plan,
              approval: {
                mode: "none",
                id: null,
                status: "not_required",
              },
              role,
              approvedByUserId: userId,
              createdAt,
            })
          : null;
      await appendOrchestratorMessage(transaction, {
        tenantId: parsed.tenantId,
        threadId: parsed.threadId,
        sourceMessageId: parsed.sourceMessageId,
        planId: plan.id,
        kind: "plan",
        text: validated.plan.finalUserMessageDraft,
        correlationId: currentSource.message.correlation_id,
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
          contextSourceCount: validated.plan.contextSources.length,
          contextWasTruncated: validated.plan.contextSources.some(
            (source) => source.truncated,
          ),
          executionEnvironment: "mock",
          estimatedExternalCost: 0,
          ...(policyReceipt
            ? {
                policyReceiptId: policyReceipt.id,
                policyReceiptFingerprint: policyReceipt.fingerprint,
              }
            : {}),
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
    await assertConversationPlanThreadAccess(
      transaction,
      userId,
      tenantId,
      plan.thread_id,
      "plan",
    );
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
    await assertConversationPlanThreadAccess(
      transaction,
      userId,
      tenantId,
      parsed.threadId,
      "plan",
    );
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
  return withTenantSystemDbTransaction(db, tenantId, userId, async (transaction) => {
    const role = await assertTenantAccess(
      transaction,
      userId,
      tenantId,
      decisionRoles,
    );
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
    await assertConversationPlanThreadAccess(
      transaction,
      userId,
      tenantId,
      existing.thread_id,
      "plan",
    );
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
    const policyReceipt =
      parsed.decision === "approved"
        ? await issueConversationActionPlanPolicyReceipt(transaction, {
            plan: decided,
            approval: {
              mode: "single",
              id: approval.id,
              status: "approved",
            },
            role,
            approvedByUserId: userId,
            createdAt: decidedAt,
          })
        : null;
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
        ...(policyReceipt
          ? {
              policyReceiptId: policyReceipt.id,
              policyReceiptFingerprint: policyReceipt.fingerprint,
            }
          : {}),
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
  const outcome = await withTenantSystemDbTransaction(
    db,
    tenantId,
    userId,
    async (transaction) => {
      await assertTenantAccess(transaction, userId, tenantId, decisionRoles);
      const plan = await lockActionPlanRow(transaction, tenantId, parsed.planId);
      if (!plan) {
        throw new OrchestratorError(
          "orchestrator_plan_not_found",
          "Le plan est introuvable.",
        );
      }
      await assertConversationPlanThreadAccess(
        transaction,
        userId,
        tenantId,
        plan.thread_id,
        "plan",
      );
      const workflowKey = conversationActionPlanWorkflowKey(plan.id);
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
        const replay = await finalizeConversationActionPlanInTransaction(
          transaction,
          {
            tenantId,
            actorId: userId,
            workflowRunId: existingRun.id,
            sourceEventId: `event_${hashToken(plan.id).slice(0, 32)}`,
          },
        );
        if (!replay) {
          throw new OrchestratorError(
            "orchestrator_execution_failed",
            "La preuve durable de l’exécution est incomplète.",
          );
        }
        return {
          result: replay.result,
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
      const policy = await assertConversationActionPlanPolicyReceipt(
        transaction,
        {
          stage: "execute",
          tenantId,
          actorId: userId,
          planId: plan.id,
        },
      );
      const definition = buildConversationPlanWorkflow(plan, steps);
      const sourceEvent = {
        id: `event_${hashToken(plan.id).slice(0, 32)}`,
        tenantId,
        actorId: userId,
        type: "conversation.plan.execute",
        payload: {
          planId: plan.id,
          planFingerprint: plan.plan_fingerprint,
          threadId: plan.thread_id,
          sourceMessageId: plan.source_message_id,
          policyReceipt: policy.evidence,
        },
        correlationId: plan.id,
        causationId: plan.source_message_id,
        idempotencyKey: `conversation.plan.execute:${plan.id}`,
      };
      await assertConversationActionPlanPolicyReceipt(transaction, {
        stage: "workflow_start",
        tenantId,
        actorId: userId,
        planId: plan.id,
        definition,
        sourceEvent,
      });
      if (existingRun?.status === "failed") {
        return { failure: "mock_workflow_failed" as const };
      }
      await updateActionPlanExecutionStatus(
        transaction,
        tenantId,
        plan.id,
        "running",
      );
      let succeededRun: NonNullable<
        Awaited<ReturnType<typeof findWorkflowRunByKey>>
      >;
      try {
        const runId = existingRun
          ? existingRun.id
          : await executeWorkflowDefinition(
              transaction,
              definition,
              sourceEvent,
            );
        const run = runId
          ? await findWorkflowRunByKey(transaction, tenantId, workflowKey)
          : existingRun ??
            (await findWorkflowRunByKey(transaction, tenantId, workflowKey));
        if (!run || run.status !== "succeeded") {
          throw new Error("mock_workflow_not_succeeded");
        }
        succeededRun = run;
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

      // Finalization is part of the same atomic unit as workflow creation. It is
      // deliberately outside the execution-failure catch: any persistence fault
      // must roll the whole transaction back instead of committing a half-finalized
      // plan as a durable workflow failure.
      const finalized = await finalizeConversationActionPlanInTransaction(
        transaction,
        {
          tenantId,
          actorId: userId,
          workflowRunId: succeededRun.id,
          sourceEventId: sourceEvent.id,
        },
      );
      if (!finalized) {
        throw new OrchestratorError(
          "orchestrator_execution_failed",
          "La preuve durable de la finalisation est introuvable.",
        );
      }
      return {
        result: finalized.result,
      };
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

export async function finalizeConversationActionPlanWorkflow(
  db: DbClient,
  input: {
    tenantId: string;
    actorId: string;
    workflowRunId: string;
    sourceEventId: string;
  },
) {
  return withSystemDbTransaction(db, (transaction) =>
    finalizeConversationActionPlanInTransaction(transaction, input),
  );
}

export async function requestConversationActionPlanRetry(
  db: DbClient,
  userId: string,
  tenantId: string,
  planId: string,
) {
  const runId = await withTenantDbTransaction(
    db,
    tenantId,
    userId,
    async (transaction) => {
      await assertTenantAccess(transaction, userId, tenantId, decisionRoles);
      const plan = await findActionPlanRow(transaction, tenantId, planId);
      if (!plan) {
        throw new OrchestratorError(
          "orchestrator_plan_not_found",
          "Le plan est introuvable.",
        );
      }
      await assertConversationPlanThreadAccess(
        transaction,
        userId,
        tenantId,
        plan.thread_id,
        "plan",
      );
      const run = await findWorkflowRunByKey(
        transaction,
        tenantId,
        conversationActionPlanWorkflowKey(plan.id),
      );
      if (!run) {
        throw new OrchestratorError(
          "orchestrator_execution_failed",
          "La mission durable à reprendre est introuvable.",
        );
      }
      return run.id;
    },
  );

  try {
    return await requestManualWorkflowRetry(db, userId, tenantId, { runId });
  } catch (error) {
    if (
      error instanceof WorkflowError &&
      error.code === "workflow_run_not_found"
    ) {
      throw new OrchestratorError(
        "orchestrator_plan_not_found",
        "Le plan est introuvable ou inaccessible.",
      );
    }
    throw error;
  }
}

type ConversationPlanGenerationSource = {
  message: ConversationMessageRow;
  contextSources: ActionPlanGenerationContextSource[];
  fingerprint: string;
};

function serializeActionPlanForPersistence(plan: ValidatedActionPlan) {
  if (plan.contextSources.length > 0) {
    return toJson(plan);
  }

  const legacyCompatiblePlan: Partial<ValidatedActionPlan> = { ...plan };
  delete legacyCompatiblePlan.contextSources;
  return toJson(legacyCompatiblePlan);
}

async function issueConversationActionPlanPolicyReceipt(
  db: DbClient,
  input: {
    plan: ConversationActionPlanRow;
    approval: ConversationActionPlanPolicyApproval;
    role: Role;
    approvedByUserId: string;
    createdAt: string;
  },
): Promise<ConversationActionPlanPolicyEvidence> {
  if (
    input.plan.approval_status !== "approved" ||
    input.plan.decided_by !== input.approvedByUserId
  ) {
    throw new OrchestratorError(
      "orchestrator_policy_receipt_invalid",
      "Le reçu de policy ne peut pas être émis sans décision cohérente.",
    );
  }
  const receipt = compileConversationActionPlanPolicyReceipt({
    tenantId: input.plan.tenant_id,
    planId: input.plan.id,
    planJson: input.plan.plan_json,
    planFingerprint: input.plan.plan_fingerprint,
    approval: input.approval,
    role: input.role,
    grantedScopes: conversationActionPlanGrantedScopes,
  });
  const inserted = await insertConversationActionPlanPolicyReceipt(db, {
    id: randomUUID(),
    tenantId: input.plan.tenant_id,
    planId: input.plan.id,
    planFingerprint: input.plan.plan_fingerprint,
    approvalId: input.approval.id,
    approvalMode: input.approval.mode,
    approvedByUserId: input.approvedByUserId,
    payloadJson: toJson(receipt.payload),
    receiptFingerprint: receipt.fingerprint,
    createdAt: input.createdAt,
  });
  if (!inserted) {
    throw new OrchestratorError(
      "orchestrator_decision_conflict",
      "Le reçu de policy de ce plan existe déjà.",
    );
  }
  return {
    id: inserted.id,
    fingerprint: inserted.receipt_fingerprint,
    schemaVersion: conversationActionPlanPolicyReceiptSchemaVersion,
  };
}

async function readConversationPlanGenerationSource(
  db: DbClient,
  userId: string,
  tenantId: string,
  threadId: string,
  sourceMessageId: string,
  options: { lockForUpdate?: boolean } = {},
): Promise<ConversationPlanGenerationSource> {
  await assertConversationPlanThreadAccess(
    db,
    userId,
    tenantId,
    threadId,
    "source",
  );
  const message = await findConversationMessageRow(
    db,
    tenantId,
    threadId,
    sourceMessageId,
    { lockForUpdate: options.lockForUpdate },
  );
  if (!message) {
    throw new OrchestratorError(
      "orchestrator_source_message_not_found",
      "Le message source du plan est introuvable.",
    );
  }
  assertValidSourceMessage(message.direction, message.kind);

  const attachments = await listConversationAttachmentRows(
    db,
    tenantId,
    [message.id],
    { lockForShare: options.lockForUpdate },
  );
  const unboundedContextSources: ActionPlanGenerationContextSource[] = [];
  for (const attachment of attachments) {
    const extraction = readExternalUntrustedDataExtraction(attachment);
    if (!extraction) continue;
    if (extraction.integrity !== "verified") {
      throw new OrchestratorError(
        "orchestrator_source_context_invalid",
        "Une source de contexte n'a pas une intégrité vérifiable.",
      );
    }
    const view = prepareExternalUntrustedDataView(extraction);
    unboundedContextSources.push({
      type: "external_untrusted_data",
      sourceId: attachment.id,
      sourceIntegrity: "verified",
      truncated: view.truncated,
      instructionsAllowed: false,
      toolAccess: "forbidden",
      policyMutation: "forbidden",
      content: view.content,
    });
  }
  const contextSources = boundActionPlanGenerationContextSources(
    unboundedContextSources,
  );
  const fingerprint = hashToken(
    toJson({
      message: {
        id: message.id,
        tenantId: message.tenant_id,
        threadId: message.thread_id,
        direction: message.direction,
        kind: message.kind,
        text: message.text_content,
      },
      contextSources,
    }),
  );
  return { message, contextSources, fingerprint };
}

async function assertConversationPlanThreadAccess(
  db: DbClient,
  userId: string,
  tenantId: string,
  threadId: string,
  target: "source" | "plan",
) {
  const thread = await findAccessibleConversationThreadRow(
    db,
    tenantId,
    userId,
    threadId,
  );
  if (thread) return thread;
  if (target === "source") {
    throw new OrchestratorError(
      "orchestrator_source_message_not_found",
      "Le message source du plan est introuvable ou inaccessible.",
    );
  }
  throw new OrchestratorError(
    "orchestrator_plan_not_found",
    "Le plan est introuvable ou inaccessible.",
  );
}

async function finalizeConversationActionPlanInTransaction(
  db: DbClient,
  input: {
    tenantId: string;
    actorId: string;
    workflowRunId: string;
    sourceEventId: string;
  },
) {
  const run = await findWorkflowRunById(
    db,
    input.tenantId,
    input.workflowRunId,
  );
  if (!run || !run.workflow_key.startsWith("conversation_plan:")) {
    return null;
  }
  if (run.status !== "succeeded") {
    return null;
  }

  const planId = run.workflow_key.slice("conversation_plan:".length);
  const plan = await lockActionPlanRow(db, input.tenantId, planId);
  if (!plan) {
    return null;
  }
  if (conversationActionPlanWorkflowKey(plan.id) !== run.workflow_key) {
    throw new OrchestratorError(
      "orchestrator_plan_not_found",
      "Le plan lié à la mission durable est introuvable.",
    );
  }
  const parsedDefinition = workflowDefinitionSchema.safeParse(
    safeJson<Record<string, unknown>>(run.definition_snapshot, {}),
  );
  const sourceEventRow = await findDomainEventById(
    db,
    input.tenantId,
    input.sourceEventId,
  );
  if (!parsedDefinition.success || !sourceEventRow) {
    throw new OrchestratorError(
      "orchestrator_policy_receipt_invalid",
      "La preuve durable de la mission autorisée est incomplète.",
    );
  }
  const sourceEvent = {
    id: sourceEventRow.id,
    tenantId: sourceEventRow.tenant_id,
    actorId: sourceEventRow.actor_id,
    type: sourceEventRow.event_type,
    payload: safeJson<Record<string, unknown>>(sourceEventRow.payload, {}),
    idempotencyKey: sourceEventRow.idempotency_key,
    correlationId: sourceEventRow.correlation_id,
    causationId: sourceEventRow.causation_id ?? undefined,
  };
  const policy = await assertConversationActionPlanPolicyReceipt(db, {
    stage: "finalize",
    tenantId: input.tenantId,
    actorId: input.actorId,
    planId: plan.id,
    definition: parsedDefinition.data,
    sourceEvent,
  });
  if (!["approved", "executed"].includes(plan.approval_status)) {
    throw new OrchestratorError(
      "orchestrator_execution_not_approved",
      "Le plan lié à la mission n’est plus approuvé.",
    );
  }

  const [planSteps, workflowSteps] = await Promise.all([
    listActionPlanStepRows(db, input.tenantId, plan.id),
    listWorkflowRunStepRows(db, input.tenantId, [run.id]),
  ]);
  if (planSteps.length !== 2) {
    throw new OrchestratorError(
      "orchestrator_execution_failed",
      "Le plan mock doit contenir exactement deux étapes.",
    );
  }
  const reconciled = reconcileConversationPlanSteps(
    planSteps,
    workflowSteps,
    input.sourceEventId,
    policy,
  );
  if (reconciled.some((step) => step.status !== "succeeded")) {
    throw new OrchestratorError(
      "orchestrator_execution_failed",
      "Les preuves durables de toutes les étapes sont incomplètes.",
    );
  }
  if (plan.approval_status === "executed") {
    await assertConversationActionPlanFinalizationProjection(db, {
      plan,
      run,
      sourceEventActorId: sourceEventRow.actor_id,
      policy,
    });
    return {
      idempotentReplay: true as const,
      result: await mapExecutionResult(db, plan, run, true),
    };
  }
  for (const step of reconciled) {
    await updateActionPlanStepStatusByPosition(db, {
      tenantId: input.tenantId,
      planId: plan.id,
      position: step.position,
      status: step.status,
    });
  }

  const executedAt = nowIso();
  const executedPlan = await markActionPlanExecuted(
    db,
    input.tenantId,
    plan.id,
    executedAt,
  );
  if (!executedPlan) {
    const concurrent = await findActionPlanRow(db, input.tenantId, plan.id);
    if (concurrent?.approval_status === "executed") {
      await assertConversationActionPlanFinalizationProjection(db, {
        plan: concurrent,
        run,
        sourceEventActorId: sourceEventRow.actor_id,
        policy,
      });
      return {
        idempotentReplay: true as const,
        result: await mapExecutionResult(db, concurrent, run, true),
      };
    }
    throw new OrchestratorError(
      "orchestrator_execution_failed",
      "La finalisation du plan est entrée en conflit.",
    );
  }

  await appendOrchestratorMessage(db, {
    tenantId: input.tenantId,
    threadId: plan.thread_id,
    sourceMessageId: plan.source_message_id,
    planId: plan.id,
    kind: "result",
    text: conversationActionPlanResultText,
    correlationId: run.id,
    createdAt: executedAt,
  });
  await updateConversationThreadStatus(db, {
    tenantId: input.tenantId,
    threadId: plan.thread_id,
    status: "open",
    updatedAt: executedAt,
  });
  await recordAuditLog(db, {
    tenantId: input.tenantId,
    actorId: sourceEventRow.actor_id,
    action: "conversation.plan_executed",
    targetType: "conversation_action_plan",
    targetId: plan.id,
    metadata: {
      threadId: plan.thread_id,
      workflowRunId: run.id,
      planFingerprint: plan.plan_fingerprint,
      executionEnvironment: "mock",
      capabilityCount: planSteps.length,
      policyReceiptId: policy.evidence.id,
      policyReceiptFingerprint: policy.evidence.fingerprint,
      externalSideEffect: false,
    },
  });

  await assertConversationActionPlanFinalizationProjection(db, {
    plan: executedPlan,
    run,
    sourceEventActorId: sourceEventRow.actor_id,
    policy,
  });

  return {
    idempotentReplay: false as const,
    result: await mapExecutionResult(db, executedPlan, run, false),
  };
}

async function assertConversationActionPlanFinalizationProjection(
  db: DbClient,
  input: {
    plan: ConversationActionPlanRow;
    run: NonNullable<Awaited<ReturnType<typeof findWorkflowRunByKey>>>;
    sourceEventActorId: string;
    policy: VerifiedConversationActionPlanPolicy;
  },
) {
  const [steps, resultMessage, executionAudits] = await Promise.all([
    listActionPlanStepRows(db, input.plan.tenant_id, input.plan.id),
    findConversationMessageByIdempotencyKey(
      db,
      input.plan.tenant_id,
      `orchestrator:${input.plan.id}:executed`,
    ),
    listAuditLogRowsByActionAndTarget(db, {
      tenantId: input.plan.tenant_id,
      action: "conversation.plan_executed",
      targetType: "conversation_action_plan",
      targetId: input.plan.id,
    }),
  ]);
  const messageIsBound =
    resultMessage?.thread_id === input.plan.thread_id &&
    resultMessage.direction === "internal" &&
    resultMessage.kind === "result" &&
    resultMessage.status === "received" &&
    resultMessage.text_content === conversationActionPlanResultText &&
    resultMessage.adapter_key === "orchestrator-mock" &&
    resultMessage.external_message_id === `${input.plan.id}:executed` &&
    resultMessage.correlation_id === input.run.id &&
    resultMessage.causation_id === input.plan.source_message_id &&
    resultMessage.safe_error_code === null &&
    resultMessage.occurred_at === input.plan.updated_at &&
    resultMessage.created_at === input.plan.updated_at;
  const audit = executionAudits[0];
  const auditMetadata = safeJson<Record<string, unknown>>(
    audit?.safe_metadata ?? "",
    {},
  );
  const expectedAuditMetadata = {
    threadId: input.plan.thread_id,
    workflowRunId: input.run.id,
    planFingerprint: input.plan.plan_fingerprint,
    executionEnvironment: "mock",
    capabilityCount: steps.length,
    policyReceiptId: input.policy.evidence.id,
    policyReceiptFingerprint: input.policy.evidence.fingerprint,
    externalSideEffect: false,
  };
  const auditIsBound =
    executionAudits.length === 1 &&
    audit?.actor_id === input.sourceEventActorId &&
    hasExactPrimitiveRecord(auditMetadata, expectedAuditMetadata);
  if (
    input.plan.approval_status !== "executed" ||
    steps.length !== 2 ||
    steps.some((step) => step.status !== "succeeded") ||
    !messageIsBound ||
    !auditIsBound
  ) {
    throw new OrchestratorError(
      "orchestrator_execution_failed",
      "La projection durable de l’exécution est incomplète ou incohérente.",
    );
  }
}

function hasExactPrimitiveRecord(
  actual: Record<string, unknown>,
  expected: Record<string, string | number | boolean>,
) {
  const actualKeys = Object.keys(actual).sort();
  const expectedKeys = Object.keys(expected).sort();
  return (
    actualKeys.length === expectedKeys.length &&
    actualKeys.every((key, index) => key === expectedKeys[index]) &&
    expectedKeys.every((key) => actual[key] === expected[key])
  );
}

function reconcileConversationPlanSteps(
  planSteps: Awaited<ReturnType<typeof listActionPlanStepRows>>,
  workflowSteps: Awaited<ReturnType<typeof listWorkflowRunStepRows>>,
  sourceEventId: string,
  policy: VerifiedConversationActionPlanPolicy,
) {
  return planSteps.map((planStep) => {
    const matching = workflowSteps.filter((workflowStep) => {
      const metadata = safeJson<Record<string, unknown>>(
        workflowStep.safe_metadata,
        {},
      );
      return (
        workflowStep.action_name ===
          conversationPlanWorkflowActionType(planStep.capability) &&
        metadata.actionIndex === planStep.position &&
        metadata.eventId === sourceEventId &&
        metadata.idempotencyKey === planStep.idempotency_key &&
        metadata.planStepId === planStep.step_id &&
        metadata.capability === planStep.capability &&
        metadata.providerKey === policy.receipt.payload.provider.key &&
        metadata.providerVersion === policy.receipt.payload.provider.version &&
        metadata.manifestVersion ===
          policy.receipt.payload.catalog.projection.manifestSchemaVersion &&
        metadata.executionEnvironment ===
          policy.receipt.payload.provider.executionEnvironment &&
        metadata.externalSideEffect === false &&
        metadata.inputStored === false
      );
    });
    const status = matching.some((step) => step.status === "succeeded")
      ? ("succeeded" as const)
      : ("failed" as const);
    return { position: planStep.position, status };
  });
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
        evidence: safeJson<Record<string, unknown>>(step.safe_metadata, {}),
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
  const [steps, approval, mission, policyReceipt] = await Promise.all([
    listActionPlanStepRows(db, plan.tenant_id, plan.id),
    findActionPlanApproval(db, plan.tenant_id, plan.id),
    findWorkflowRunByKey(
      db,
      plan.tenant_id,
      conversationActionPlanWorkflowKey(plan.id),
    ),
    findConversationActionPlanPolicyReceiptByPlan(
      db,
      plan.tenant_id,
      plan.id,
    ),
  ]);
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
    policyReceipt: policyReceipt
      ? {
          id: policyReceipt.id,
          fingerprint: policyReceipt.receipt_fingerprint,
          schemaVersion: conversationActionPlanPolicyReceiptSchemaVersion,
        }
      : undefined,
    mission: mission
      ? {
          workflowRunId: mission.id,
          status: mission.status,
          summary: mission.summary,
          retryCount: Number(mission.retry_count),
        }
      : undefined,
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

function normalizeGeneratedPlanMetadata(
  generationSource: unknown,
  modelReference: unknown,
): {
  generationSource: "deterministic_mock" | "model";
  modelReference: string | null;
} {
  if (generationSource === "deterministic_mock") {
    if (modelReference !== undefined) {
      throw incoherentGenerationSourceError();
    }
    return { generationSource, modelReference: null };
  }
  if (generationSource === "model" && typeof modelReference === "string") {
    const normalizedReference = modelReference.trim();
    if (normalizedReference.length > 0 && normalizedReference.length <= 160) {
      return { generationSource, modelReference: normalizedReference };
    }
  }
  throw incoherentGenerationSourceError();
}

function cloneValidatedActionPlan(
  plan: ValidatedActionPlan,
): ValidatedActionPlan {
  return JSON.parse(JSON.stringify(plan)) as ValidatedActionPlan;
}

function incoherentGenerationSourceError() {
  return new OrchestratorError(
    "orchestrator_capability_mismatch",
    "La source de génération du plan est incohérente.",
  );
}

function unsafeGeneratedPlanContractError() {
  return new OrchestratorError(
    "orchestrator_generated_plan_unsafe",
    "Le plan généré ne respecte pas le contrat de sécurité.",
  );
}
