import { hashToken } from "@/lib/security";
import type { ActionPlan } from "@/modules/orchestrator/schemas";

export type ActionPlanGenerationContext = {
  tenantId: string;
  threadId: string;
  sourceMessageId: string;
  sourceText: string | null;
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
      return {
        generationSource: "deterministic_mock",
        plan: {
          intent: "Préparer une relance commerciale",
          businessGoal:
            "Retrouver le contact lié à la conversation puis préparer une tâche de suivi.",
          confidence: context.sourceText ? 0.9 : 0.75,
          missingContextQuestions: [],
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
