import type { DbClient } from "@/lib/db";
import { hashToken, safeJson, toJson } from "@/lib/security";
import type { Role } from "@/lib/types";
import {
  findAccessibleConversationThreadRow,
  lockConversationThreadAccessGrant,
} from "@/modules/conversation-hub/repository";
import {
  conversationActionPlanPolicyReceiptSchemaVersion,
  verifyConversationActionPlanPolicyReceipt,
  type ConversationActionPlanPolicyApproval,
  type ConversationActionPlanPolicyReceipt,
} from "@/modules/orchestrator/policy";
import { OrchestratorError } from "@/modules/orchestrator/errors";
import {
  lockActionPlanApproval,
  lockActionPlanRow,
  lockActionPlanStepRows,
  lockConversationActionPlanPolicyReceiptByPlan,
  type ConversationActionPlanPolicyReceiptRow,
  type ConversationActionPlanRow,
  type ConversationActionPlanStepRow,
} from "@/modules/orchestrator/repository";
import {
  assertConversationPlanWorkflowDefinition,
  conversationActionPlanWorkflowTrigger,
} from "@/modules/orchestrator/workflow-plan";
import { lockMembershipRole } from "@/modules/tenants/repository";
import {
  findDomainEventById,
  findWorkflowRunById,
} from "@/modules/workflows/repository";
import {
  workflowActionSchema,
  workflowDefinitionSchema,
  type WorkflowAction,
  type WorkflowDefinition,
  type WorkflowEvent,
} from "@/modules/workflows/types";

export const conversationActionPlanGrantedScopes = Object.freeze([
  "crm.contacts.read",
  "project.tasks.write",
] as const);

const executionRoles: readonly Role[] = [
  "owner",
  "administrator",
  "manager",
];

export type ConversationActionPlanPolicyStage =
  | "execute"
  | "workflow_start"
  | "manual_retry"
  | "workflow_resume"
  | "finalize";

export type ConversationActionPlanPolicyEvidence = {
  id: string;
  fingerprint: string;
  schemaVersion: typeof conversationActionPlanPolicyReceiptSchemaVersion;
};

export type VerifiedConversationActionPlanPolicy = {
  plan: ConversationActionPlanRow;
  steps: ConversationActionPlanStepRow[];
  receiptRow: ConversationActionPlanPolicyReceiptRow;
  receipt: ConversationActionPlanPolicyReceipt;
  evidence: ConversationActionPlanPolicyEvidence;
};

export async function assertConversationActionPlanPolicyReceipt(
  db: DbClient,
  input: {
    stage: ConversationActionPlanPolicyStage;
    tenantId: string;
    actorId: string;
    planId: string;
    definition?: WorkflowDefinition;
    sourceEvent?: WorkflowEvent;
  },
): Promise<VerifiedConversationActionPlanPolicy> {
  const plan = await lockActionPlanRow(db, input.tenantId, input.planId);
  if (!plan || !["approved", "executed"].includes(plan.approval_status)) {
    throw invalidPolicyReceipt(
      "Le plan n’a pas de décision exécutable liée à une policy serveur.",
    );
  }
  if (!plan.decided_by) {
    throw invalidPolicyReceipt(
      "Le principal ayant autorisé le plan est introuvable.",
    );
  }

  const steps = await lockActionPlanStepRows(db, input.tenantId, plan.id);
  const approval = await lockActionPlanApproval(db, input.tenantId, plan.id);
  const receiptRow = await lockConversationActionPlanPolicyReceiptByPlan(
    db,
    input.tenantId,
    plan.id,
  );
  const roles = new Map<string, Role | null>();
  for (const userId of [...new Set([plan.decided_by, input.actorId])].sort()) {
    roles.set(
      userId,
      await lockMembershipRole(db, userId, input.tenantId),
    );
  }
  const principalRole = roles.get(plan.decided_by) ?? null;
  const actorRole = roles.get(input.actorId) ?? null;
  const thread = await findAccessibleConversationThreadRow(
    db,
    input.tenantId,
    input.actorId,
    plan.thread_id,
  );
  const threadAccessLocked = thread
    ? await lockConversationThreadAccessGrant(
        db,
        input.tenantId,
        input.actorId,
        thread,
      )
    : false;
  if (
    !receiptRow ||
    receiptRow.tenant_id !== input.tenantId ||
    receiptRow.plan_id !== plan.id ||
    receiptRow.plan_fingerprint !== plan.plan_fingerprint ||
    receiptRow.approved_by_user_id !== plan.decided_by
  ) {
    throw invalidPolicyReceipt(
      "Le reçu de policy durable est absent ou lié à un autre plan.",
    );
  }
  if (!principalRole) {
    throw invalidPolicyReceipt(
      "Le principal du reçu n’est plus membre de l’organisation.",
    );
  }
  if (
    !actorRole ||
    !executionRoles.includes(actorRole) ||
    !thread ||
    !threadAccessLocked
  ) {
    throw invalidPolicyReceipt(
      "L’acteur ne peut plus exécuter ce plan dans cette organisation.",
    );
  }

  const policyApproval = resolvePolicyApproval(receiptRow, approval);
  const payload = safeJson<unknown>(receiptRow.payload_json, null);
  const receipt = verifyConversationActionPlanPolicyReceipt(
    { payload, fingerprint: receiptRow.receipt_fingerprint },
    {
      tenantId: input.tenantId,
      planId: plan.id,
      planJson: plan.plan_json,
      planFingerprint: plan.plan_fingerprint,
      approval: policyApproval,
      role: principalRole,
      grantedScopes: conversationActionPlanGrantedScopes,
    },
  );
  const evidence = {
    id: receiptRow.id,
    fingerprint: receiptRow.receipt_fingerprint,
    schemaVersion: conversationActionPlanPolicyReceiptSchemaVersion,
  } satisfies ConversationActionPlanPolicyEvidence;

  const requiresBoundExecution = input.stage !== "execute";
  if (requiresBoundExecution && (!input.definition || !input.sourceEvent)) {
    throw invalidPolicyReceipt(
      "La preuve d’exécution liée au reçu de policy est incomplète.",
    );
  }
  if (input.definition) {
    assertConversationPlanWorkflowDefinition(input.definition, plan, steps);
  }
  if (input.sourceEvent) {
    assertSourceEventBinding(input.sourceEvent, plan, evidence);
  }

  return { plan, steps, receiptRow, receipt, evidence };
}

export function isConversationActionPlanWorkflow(
  definition: WorkflowDefinition,
  event: WorkflowEvent,
) {
  return (
    definition.key.startsWith("conversation_plan:") ||
    definition.trigger === conversationActionPlanWorkflowTrigger ||
    event.type === conversationActionPlanWorkflowTrigger ||
    definition.actions.some(isConversationActionPlanWorkflowAction)
  );
}

export function isConversationActionPlanWorkflowRun(run: {
  workflow_key: string;
  trigger_name: string;
  definition_snapshot: string | null;
}) {
  if (
    run.workflow_key.startsWith("conversation_plan:") ||
    run.trigger_name === conversationActionPlanWorkflowTrigger
  ) {
    return true;
  }
  if (run.definition_snapshot === null) return false;
  const definition = workflowDefinitionSchema.safeParse(
    safeJson<Record<string, unknown>>(run.definition_snapshot, {}),
  );
  if (!definition.success) return true;
  return definition.data.actions.some(
    (action) =>
      action.type === "mock_search_contact" ||
      action.type === "mock_create_task",
  );
}

export async function assertConversationActionPlanWorkflowPolicy(
  db: DbClient,
  input: {
    stage: Exclude<ConversationActionPlanPolicyStage, "execute">;
    definition: WorkflowDefinition;
    event: WorkflowEvent;
    actorId?: string;
  },
) {
  if (!isConversationActionPlanWorkflow(input.definition, input.event)) {
    return null;
  }
  const planId = stringValue(input.event.payload.planId);
  if (!planId) {
    throw invalidPolicyReceipt(
      "L’événement de mission ne référence aucun plan autorisé.",
    );
  }
  return assertConversationActionPlanPolicyReceipt(db, {
    stage: input.stage,
    tenantId: input.event.tenantId,
    actorId: input.actorId ?? input.event.actorId,
    planId,
    definition: input.definition,
    sourceEvent: input.event,
  });
}

export async function assertConversationActionPlanWorkflowActionPolicy(
  db: DbClient,
  input: {
    runId: string;
    definition: WorkflowDefinition;
    event: WorkflowEvent;
    action: WorkflowAction;
    actionIndex: number;
    actionIdempotencyKey: string;
  },
) {
  const definition = workflowDefinitionSchema.safeParse(input.definition);
  const action = workflowActionSchema.safeParse(input.action);
  const expectedAction = Number.isInteger(input.actionIndex)
    ? definition.success
      ? definition.data.actions[input.actionIndex]
      : undefined
    : undefined;
  const expectedIdempotencyKey = expectedAction
    ? expectedAction.idempotencyKey ??
      `${input.event.idempotencyKey}:a${input.actionIndex}:${expectedAction.type}`
    : null;
  if (
    !definition.success ||
    !action.success ||
    input.actionIndex < 0 ||
    !expectedAction ||
    toJson(action.data) !== toJson(expectedAction) ||
    input.actionIdempotencyKey !== expectedIdempotencyKey
  ) {
    throw invalidPolicyReceipt(
      "L’action demandée ne correspond pas à l’étape autorisée de la mission.",
    );
  }

  const requiresConversationPolicy =
    isConversationActionPlanWorkflow(definition.data, input.event) ||
    isConversationActionPlanWorkflowAction(action.data);
  if (!requiresConversationPolicy) {
    return null;
  }
  const policy = await assertConversationActionPlanWorkflowPolicy(db, {
    stage: "workflow_start",
    definition: definition.data,
    event: input.event,
  });
  if (!policy) {
    throw invalidPolicyReceipt(
      "La policy de l’action de mission est introuvable.",
    );
  }

  const [run, durableEvent] = await Promise.all([
    findWorkflowRunById(db, input.event.tenantId, input.runId),
    findDomainEventById(db, input.event.tenantId, input.event.id),
  ]);
  const snapshot = run?.definition_snapshot
    ? workflowDefinitionSchema.safeParse(
        safeJson<Record<string, unknown>>(run.definition_snapshot, {}),
      )
    : null;
  const durablePayload = durableEvent
    ? safeJson<Record<string, unknown>>(durableEvent.payload, {})
    : null;
  if (
    !run ||
    run.status !== "running" ||
    run.workflow_key !== definition.data.key ||
    run.trigger_name !== definition.data.trigger ||
    run.definition_version !== definition.data.version ||
    !snapshot?.success ||
    toJson(snapshot.data) !== toJson(definition.data) ||
    !durableEvent ||
    durableEvent.actor_id !== input.event.actorId ||
    durableEvent.event_type !== input.event.type ||
    durableEvent.idempotency_key !== input.event.idempotencyKey ||
    durableEvent.correlation_id !== input.event.correlationId ||
    durableEvent.causation_id !== (input.event.causationId ?? null) ||
    !durablePayload ||
    toJson(durablePayload) !== toJson(input.event.payload)
  ) {
    throw invalidPolicyReceipt(
      "L’action ne correspond pas à une mission durable en cours.",
    );
  }
  return policy;
}

function isConversationActionPlanWorkflowAction(action: WorkflowAction) {
  return (
    action.type === "mock_search_contact" || action.type === "mock_create_task"
  );
}

function resolvePolicyApproval(
  receiptRow: ConversationActionPlanPolicyReceiptRow,
  approval: Awaited<ReturnType<typeof lockActionPlanApproval>>,
): ConversationActionPlanPolicyApproval {
  if (receiptRow.approval_mode === "none") {
    if (
      approval ||
      receiptRow.approval_id !== null ||
      receiptRow.approval_status !== "not_required"
    ) {
      throw invalidPolicyReceipt(
        "Le reçu sans validation ne correspond pas au plan durable.",
      );
    }
    return { mode: "none", id: null, status: "not_required" };
  }
  if (
    !approval ||
    approval.id !== receiptRow.approval_id ||
    approval.status !== "approved" ||
    receiptRow.approval_status !== "approved"
  ) {
    throw invalidPolicyReceipt(
      "La validation durable ne correspond pas au reçu de policy.",
    );
  }
  return { mode: "single", id: approval.id, status: "approved" };
}

function assertSourceEventBinding(
  event: WorkflowEvent,
  plan: ConversationActionPlanRow,
  evidence: ConversationActionPlanPolicyEvidence,
) {
  const receipt = objectValue(event.payload.policyReceipt);
  if (
    event.id !== `event_${hashToken(plan.id).slice(0, 32)}` ||
    event.tenantId !== plan.tenant_id ||
    event.type !== conversationActionPlanWorkflowTrigger ||
    event.correlationId !== plan.id ||
    event.causationId !== plan.source_message_id ||
    event.idempotencyKey !== `${conversationActionPlanWorkflowTrigger}:${plan.id}` ||
    stringValue(event.payload.planId) !== plan.id ||
    stringValue(event.payload.planFingerprint) !== plan.plan_fingerprint ||
    stringValue(event.payload.threadId) !== plan.thread_id ||
    stringValue(event.payload.sourceMessageId) !== plan.source_message_id ||
    stringValue(receipt?.id) !== evidence.id ||
    stringValue(receipt?.fingerprint) !== evidence.fingerprint ||
    numberValue(receipt?.schemaVersion) !== evidence.schemaVersion ||
    !hasExactKeys(event.payload, [
      "planId",
      "planFingerprint",
      "policyReceipt",
      "sourceMessageId",
      "threadId",
    ]) ||
    !receipt ||
    !hasExactKeys(receipt, ["fingerprint", "id", "schemaVersion"])
  ) {
    throw invalidPolicyReceipt(
      "L’événement source ne correspond pas au reçu de policy autorisé.",
    );
  }
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
) {
  const actual = Object.keys(value).sort();
  const canonicalExpected = [...expected].sort();
  return (
    actual.length === canonicalExpected.length &&
    actual.every((key, index) => key === canonicalExpected[index])
  );
}

function objectValue(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? value : null;
}

function numberValue(value: unknown) {
  return typeof value === "number" ? value : null;
}

function invalidPolicyReceipt(message: string) {
  return new OrchestratorError("orchestrator_policy_receipt_invalid", message);
}
