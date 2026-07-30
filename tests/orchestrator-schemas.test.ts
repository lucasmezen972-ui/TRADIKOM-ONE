import { describe, expect, it } from "vitest";
import {
  actionPlanProposalSchema,
  actionPlanSchema,
  type ActionPlan,
} from "../src/modules/orchestrator";

describe("schémas de l'orchestrateur", () => {
  it("valide un plan métier structuré avec deux capacités génériques", () => {
    const plan = planFixture();
    expect(actionPlanSchema.parse(plan)).toMatchObject({
      intent: "Préparer une relance commerciale",
      steps: [
        { capability: "crm.contacts.search", risk: "low" },
        {
          capability: "project.task.create",
          risk: "medium",
          requiresApproval: true,
        },
      ],
    });
  });

  it("refuse les doublons, les secrets et les noms de fournisseur", () => {
    const duplicate = planFixture();
    duplicate.steps[1].stepId = duplicate.steps[0].stepId;
    duplicate.steps[1].idempotencyKey = duplicate.steps[0].idempotencyKey;
    expect(actionPlanSchema.safeParse(duplicate).success).toBe(false);

    const secret = planFixture();
    secret.steps[0].input = { auth: { apiKey: "interdit" } };
    expect(actionPlanSchema.safeParse(secret).success).toBe(false);

    const providerAction = planFixture();
    providerAction.steps[0].capability = "HubSpot.search";
    expect(actionPlanSchema.safeParse(providerAction).success).toBe(false);
  });

  it("conserve source, version et état d'approbation sans exécuter", () => {
    const proposal = actionPlanProposalSchema.parse({
      id: "plan_proposal_1",
      tenantId: "tenant_plan_1",
      threadId: "thread_plan_1",
      sourceMessageId: "message_plan_1",
      schemaVersion: 1,
      generationSource: "deterministic_mock",
      approvalStatus: "awaiting_approval",
      createdAt: "2026-07-30T13:55:00.000Z",
      plan: planFixture(),
    });
    expect(proposal).toMatchObject({
      schemaVersion: 1,
      generationSource: "deterministic_mock",
      approvalStatus: "awaiting_approval",
    });
    expect(proposal).not.toHaveProperty("execution");
  });

  it("refuse l'approbation d'un plan encore incomplet", () => {
    expect(
      actionPlanProposalSchema.safeParse({
        id: "plan_proposal_2",
        tenantId: "tenant_plan_1",
        threadId: "thread_plan_1",
        sourceMessageId: "message_plan_1",
        schemaVersion: 1,
        generationSource: "model",
        approvalStatus: "approved",
        createdAt: "2026-07-30T13:55:00.000Z",
        plan: {
          ...planFixture(),
          missingContextQuestions: ["Quel contact faut-il relancer ?"],
        },
      }).success,
    ).toBe(false);
  });
});

function planFixture(): ActionPlan {
  return {
    intent: "Préparer une relance commerciale",
    businessGoal: "Retrouver le contact puis créer une tâche de suivi",
    confidence: 0.96,
    missingContextQuestions: [],
    riskSummary: "Lecture locale puis création d'une tâche réversible.",
    estimatedCost: { amount: 0, currency: "eur" },
    steps: [
      {
        stepId: "search_contact",
        capability: "crm.contacts.search",
        providerPreference: [],
        input: { query: "cliente de démonstration" },
        risk: "low",
        requiresApproval: false,
        reversible: true,
        evidenceRequired: ["Nombre de contacts correspondants"],
        idempotencyKey: "plan_step_search_contact",
      },
      {
        stepId: "create_follow_up",
        capability: "project.task.create",
        providerPreference: [],
        input: { title: "Relancer la cliente" },
        risk: "medium",
        requiresApproval: true,
        reversible: true,
        evidenceRequired: ["Identifiant de la tâche mock"],
        idempotencyKey: "plan_step_create_follow_up",
      },
    ],
    finalUserMessageDraft:
      "Je vais rechercher le contact puis préparer une tâche de relance.",
  };
}
