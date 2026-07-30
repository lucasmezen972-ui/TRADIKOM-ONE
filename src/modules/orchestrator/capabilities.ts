import { z } from "zod";
import type { Role } from "@/lib/types";
import { OrchestratorError } from "@/modules/orchestrator/errors";
import {
  actionPlanSchema,
  type ActionPlan,
  type CapabilityRisk,
} from "@/modules/orchestrator/schemas";

export type ApprovalMode = "none" | "single";

export type MockCapabilityDefinition = {
  name: string;
  description: string;
  mode: "read" | "write";
  executionEnvironment: "mock";
  risk: CapabilityRisk;
  approval: ApprovalMode;
  reversible: boolean | "compensation_only";
  compensation: string | null;
  inputSchema: z.ZodType;
  outputSchema: z.ZodType;
  requiredScopes: string[];
  idempotency: "required";
  maxBatchSize: number;
  dataCategories: string[];
  costModel: { unit: "request"; estimate: 0 };
};

const contactSearchInputSchema = z
  .object({ query: z.string().trim().min(1).max(200) })
  .strict();
const contactSearchOutputSchema = z
  .object({ matchCount: z.number().int().nonnegative().max(20) })
  .strict();
const taskCreateInputSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    dueAt: z.string().datetime({ offset: true }).optional(),
  })
  .strict();
const taskCreateOutputSchema = z
  .object({ taskReference: z.string().trim().min(1).max(160) })
  .strict();

export const os1MockCapabilityCatalog = [
  {
    name: "crm.contacts.search",
    description: "Recherche déterministe de contacts de démonstration.",
    mode: "read",
    executionEnvironment: "mock",
    risk: "low",
    approval: "none",
    reversible: true,
    compensation: null,
    inputSchema: contactSearchInputSchema,
    outputSchema: contactSearchOutputSchema,
    requiredScopes: ["crm.contacts.read"],
    idempotency: "required",
    maxBatchSize: 20,
    dataCategories: ["contacts"],
    costModel: { unit: "request", estimate: 0 },
  },
  {
    name: "project.task.create",
    description: "Création déterministe d'une tâche de démonstration.",
    mode: "write",
    executionEnvironment: "mock",
    risk: "medium",
    approval: "single",
    reversible: true,
    compensation: "project.task.archive",
    inputSchema: taskCreateInputSchema,
    outputSchema: taskCreateOutputSchema,
    requiredScopes: ["project.tasks.write"],
    idempotency: "required",
    maxBatchSize: 1,
    dataCategories: ["operational_tasks"],
    costModel: { unit: "request", estimate: 0 },
  },
] satisfies MockCapabilityDefinition[];

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

  const catalog = context.catalog ?? os1MockCapabilityCatalog;
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
