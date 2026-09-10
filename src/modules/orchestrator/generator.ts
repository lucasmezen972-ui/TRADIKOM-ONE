import { hashToken } from "@/lib/security";
import { OrchestratorError } from "@/modules/orchestrator/errors";
import {
  actionPlanContextSourceSchema,
  type ActionPlan,
  type ActionPlanContextSource,
} from "@/modules/orchestrator/schemas";

export const maximumActionPlanContextSources = 10;
export const maximumActionPlanContextCharacters = 16_000;

export type ActionPlanGenerationContextSource = ActionPlanContextSource & {
  content: string;
};

export type ActionPlanGenerationContext = {
  tenantId: string;
  threadId: string;
  sourceMessageId: string;
  sourceText: string | null;
  contextSources?: readonly ActionPlanGenerationContextSource[];
};

export type GeneratedActionPlan = {
  generationSource: "deterministic_mock" | "model";
  modelReference?: string;
  plan: ActionPlan;
};

export interface ActionPlanGenerator {
  generate(
    context: ActionPlanGenerationContext,
  ): Promise<GeneratedActionPlan>;
}

export function createDeterministicActionPlanGenerator(): ActionPlanGenerator {
  return {
    async generate(context) {
      const sourceFingerprint = hashToken(context.sourceMessageId).slice(0, 32);
      const contextSources = boundActionPlanGenerationContextSources(
        context.contextSources ?? [],
      );
      return {
        generationSource: "deterministic_mock",
        plan: {
          intent: "Préparer une relance commerciale",
          businessGoal:
            "Retrouver le contact lié à la conversation puis préparer une tâche de suivi.",
          confidence: context.sourceText ? 0.9 : 0.75,
          missingContextQuestions: [],
          contextSources: contextSources.map(toActionPlanContextSourceMetadata),
          riskSummary:
            "Lecture de démonstration puis création réversible d'une tâche mock.",
          estimatedCost: { amount: 0, currency: "EUR" },
          steps: [
            {
              stepId: "search_contact",
              capability: "crm.contacts.search",
              providerPreference: [],
              input: { query: "contact lié à la conversation" },
              risk: "low",
              requiresApproval: false,
              reversible: true,
              evidenceRequired: ["Nombre de contacts mock correspondants"],
              idempotencyKey: `plan:${sourceFingerprint}:search_contact`,
            },
            {
              stepId: "create_follow_up",
              capability: "project.task.create",
              providerPreference: [],
              input: { title: "Relancer le contact de la conversation" },
              risk: "medium",
              requiresApproval: true,
              reversible: true,
              evidenceRequired: ["Référence de la tâche mock"],
              idempotencyKey: `plan:${sourceFingerprint}:create_follow_up`,
            },
          ],
          finalUserMessageDraft:
            "Je propose de retrouver le contact puis de préparer une tâche de relance. Une seule validation confirmera le plan complet.",
        },
      };
    },
  };
}

export function boundActionPlanGenerationContextSources(
  sources: readonly ActionPlanGenerationContextSource[],
): ActionPlanGenerationContextSource[] {
  if (sources.length > maximumActionPlanContextSources) {
    throw new OrchestratorError(
      "orchestrator_source_context_invalid",
      "Le nombre de sources de contexte dépasse la limite autorisée.",
    );
  }

  let remainingCharacters = maximumActionPlanContextCharacters;
  const boundedSources: ActionPlanGenerationContextSource[] = [];
  for (const source of sources) {
    if (remainingCharacters === 0) break;
    const metadata = toActionPlanContextSourceMetadata(source);
    const content = source.content.slice(0, remainingCharacters);
    if (content.length === 0) continue;
    remainingCharacters -= content.length;
    boundedSources.push({
      ...metadata,
      truncated: metadata.truncated || content.length < source.content.length,
      content,
    });
  }
  return boundedSources;
}

export function toActionPlanContextSourceMetadata(
  source: ActionPlanGenerationContextSource,
): ActionPlanContextSource {
  return actionPlanContextSourceSchema.parse({
    type: source.type,
    sourceId: source.sourceId,
    sourceIntegrity: source.sourceIntegrity,
    truncated: source.truncated,
    instructionsAllowed: source.instructionsAllowed,
    toolAccess: source.toolAccess,
    policyMutation: source.policyMutation,
  });
}
