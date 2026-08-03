import type { Role } from "@/lib/types";
import {
  os3MockCapabilityCatalog,
  type GenericCapabilityDefinition,
} from "@/modules/connector-execution/capabilities";
import { OrchestratorError } from "@/modules/orchestrator/errors";
import {
  actionPlanSchema,
  type ActionPlan,
} from "@/modules/orchestrator/schemas";

export type MockCapabilityDefinition = GenericCapabilityDefinition;

// Alias de compatibilité pour les plans OS-1 déjà persistés.
export const os1MockCapabilityCatalog = os3MockCapabilityCatalog;

const planRoles: Role[] = [
  "owner",
  "administrator",
  "manager",
  "collaborator",
];

export function validateActionPlan(
  input: ActionPlan,
  context: {
    role: Role;
    grantedScopes: string[];
    catalog?: MockCapabilityDefinition[];
  },
) {
  if (!planRoles.includes(context.role)) {
    throw new OrchestratorError(
      "orchestrator_permission_denied",
      "Votre rôle ne permet pas de préparer ce plan.",
    );
  }
  const plan = actionPlanSchema.parse(input);
  if (plan.missingContextQuestions.length > 0) {
    throw new OrchestratorError(
      "orchestrator_plan_incomplete",
      "Le plan nécessite encore une précision métier.",
    );
  }
  if (plan.estimatedCost && plan.estimatedCost.amount > 0) {
    throw new OrchestratorError(
      "orchestrator_external_cost_forbidden",
      "Cette première tranche n'autorise aucune dépense externe.",
    );
  }

  const catalog = context.catalog ?? os3MockCapabilityCatalog;
  const validatedSteps = plan.steps.map((step) => {
    const capability = catalog.find((entry) => entry.name === step.capability);
    if (!capability) {
      throw new OrchestratorError(
        "orchestrator_capability_unavailable",
        `La capacité ${step.capability} n'est pas disponible.`,
      );
    }
    const expectedApproval = capability.approval !== "none";
    const scopesAvailable = capability.requiredScopes.every((scope) =>
      context.grantedScopes.includes(scope),
    );
    if (!scopesAvailable) {
      throw new OrchestratorError(
        "orchestrator_scope_missing",
        `Les droits de ${step.capability} ne sont pas disponibles.`,
      );
    }
    if (
      step.risk !== capability.risk ||
      step.requiresApproval !== expectedApproval ||
      step.reversible !== capability.reversible
    ) {
      throw new OrchestratorError(
        "orchestrator_capability_mismatch",
        `La capacité ${step.capability} ne respecte pas sa politique.`,
      );
    }
    capability.inputSchema.parse(step.input);
    return { step, capability };
  });

  const approvalRequired = validatedSteps.some(
    ({ capability }) => capability.approval === "single",
  );
  return {
    plan,
    executionEnvironment: "mock" as const,
    estimatedExternalCost: 0,
    approval: approvalRequired
      ? {
          mode: "single" as const,
          summary:
            "Une seule validation confirme l'ensemble du plan immuable.",
        }
      : { mode: "none" as const, summary: "Aucune validation requise." },
    capabilities: validatedSteps.map(({ capability }) => ({
      name: capability.name,
      mode: capability.mode,
      risk: capability.risk,
      environment: capability.executionEnvironment,
    })),
  };
}
