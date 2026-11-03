import { safeJson, toJson } from "@/lib/security";
import { os1MockCapabilityCatalog } from "@/modules/orchestrator/capabilities";
import { OrchestratorError } from "@/modules/orchestrator/errors";
import type {
  ConversationActionPlanRow,
  ConversationActionPlanStepRow,
} from "@/modules/orchestrator/repository";
import { actionPlanSchema } from "@/modules/orchestrator/schemas";
import {
  workflowDefinitionSchema,
  type WorkflowDefinition,
} from "@/modules/workflows/types";

export const conversationActionPlanWorkflowTrigger =
  "conversation.plan.execute" as const;

export function conversationActionPlanWorkflowKey(planId: string) {
  return `conversation_plan:${planId}`;
}

export function buildConversationPlanWorkflow(
  plan: ConversationActionPlanRow,
  steps: readonly ConversationActionPlanStepRow[],
) {
  assertStoredConversationActionPlanSteps(plan, steps);

  return workflowDefinitionSchema.parse({
    key: conversationActionPlanWorkflowKey(plan.id),
    version: 1,
    trigger: conversationActionPlanWorkflowTrigger,
    active: true,
    conditions: [],
    actions: steps.map((step) => ({
      type: conversationPlanWorkflowActionType(step.capability),
      input: {
        planStepId: step.step_id,
        capability: step.capability,
        capabilityInput: parseStoredJson(step.input_json),
      },
      idempotencyKey: step.idempotency_key,
    })),
    retryPolicy: { maxAttempts: 3, backoffMs: 500 },
    timeoutMs: 30_000,
    approvalPolicy: "no_approval_required",
  });
}

export function assertConversationPlanWorkflowDefinition(
  definition: WorkflowDefinition,
  plan: ConversationActionPlanRow,
  steps: readonly ConversationActionPlanStepRow[],
) {
  let parsed: WorkflowDefinition;
  try {
    parsed = workflowDefinitionSchema.parse(definition);
  } catch {
    throw invalidPolicyReceipt(
      "La définition de mission liée au plan est invalide.",
    );
  }
  const expected = buildConversationPlanWorkflow(plan, steps);
  if (toJson(parsed) !== toJson(expected)) {
    throw invalidPolicyReceipt(
      "La définition de mission ne correspond pas au plan autorisé.",
    );
  }
  return expected;
}

function assertStoredConversationActionPlanSteps(
  plan: ConversationActionPlanRow,
  steps: readonly ConversationActionPlanStepRow[],
) {
  let persistedPlan: ReturnType<typeof actionPlanSchema.parse>;
  try {
    persistedPlan = actionPlanSchema.parse(JSON.parse(plan.plan_json));
  } catch {
    throw invalidPolicyReceipt("Le plan durable est invalide.");
  }

  if (persistedPlan.steps.length !== steps.length) {
    throw invalidPolicyReceipt(
      "Les étapes durables ne correspondent pas au plan autorisé.",
    );
  }

  for (const [position, storedStep] of steps.entries()) {
    const planStep = persistedPlan.steps[position];
    const capability = os1MockCapabilityCatalog.find(
      (entry) => entry.name === planStep?.capability,
    );
    if (
      !planStep ||
      !capability ||
      storedStep.tenant_id !== plan.tenant_id ||
      storedStep.plan_id !== plan.id ||
      Number(storedStep.position) !== position ||
      storedStep.step_id !== planStep.stepId ||
      storedStep.capability !== planStep.capability ||
      storedStep.mode !== capability.mode ||
      storedStep.execution_environment !== "mock" ||
      storedStep.risk !== planStep.risk ||
      Number(storedStep.requires_approval) !==
        (planStep.requiresApproval ? 1 : 0) ||
      storedStep.reversible !== reversibleValue(planStep.reversible) ||
      toJson(parseStoredJson(storedStep.input_json)) !==
        toJson(planStep.input) ||
      toJson(parseStoredJson(storedStep.evidence_required_json)) !==
        toJson(planStep.evidenceRequired) ||
      storedStep.idempotency_key !== planStep.idempotencyKey
    ) {
      throw invalidPolicyReceipt(
        "Une étape durable ne correspond pas au plan autorisé.",
      );
    }
  }
}

export function conversationPlanWorkflowActionType(capability: string) {
  if (capability === "crm.contacts.search") return "mock_search_contact";
  if (capability === "project.task.create") return "mock_create_task";
  throw new OrchestratorError(
    "orchestrator_capability_unavailable",
    "Une capacité du plan n’est pas exécutable en mock.",
  );
}

function parseStoredJson(value: string) {
  const parsed = safeJson<unknown>(value, undefined);
  if (parsed === undefined) {
    throw invalidPolicyReceipt("Une preuve JSON durable est invalide.");
  }
  return parsed;
}

function reversibleValue(value: boolean | "compensation_only") {
  if (value === "compensation_only") return value;
  return value ? ("true" as const) : ("false" as const);
}

function invalidPolicyReceipt(message: string) {
  return new OrchestratorError("orchestrator_policy_receipt_invalid", message);
}
