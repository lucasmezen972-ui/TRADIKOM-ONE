import { describe, expect, it } from "vitest";
import {
  validateActionPlan,
  validateActionPlanProposal,
  type ActionPlan,
} from "../src/modules/orchestrator";

describe("catalogue de capacités OS-1", () => {
  it("valide deux capacités mock et produit une seule approbation", () => {
    const result = validateActionPlan(planFixture(), {
      role: "owner",
      grantedScopes: ["crm.contacts.read", "project.tasks.write"],
    });
    expect(result).toMatchObject({
      executionEnvironment: "mock",
      estimatedExternalCost: 0,
      approval: { mode: "single" },
      capabilities: [
        { name: "crm.contacts.search", environment: "mock" },
        { name: "project.task.create", environment: "mock" },
      ],
    });
  });

  it("refuse capacité absente, politique altérée et scope manquant", () => {
    const absent = planFixture();
    absent.steps[0].capability = "calendar.event.delete";
    expect(() => validate(absent)).toThrowError(
      expect.objectContaining({ code: "orchestrator_capability_unavailable" }),
    );

    const altered = planFixture();
    altered.steps[1].requiresApproval = false;
    expect(() => validate(altered)).toThrowError(
      expect.objectContaining({ code: "orchestrator_capability_mismatch" }),
    );

    expect(() =>
      validateActionPlan(planFixture(), {
        role: "owner",
        grantedScopes: ["crm.contacts.read"],
      }),
    ).toThrowError(
      expect.objectContaining({ code: "orchestrator_scope_missing" }),
    );
  });

  it("accepte une proposition incomplète tout en laissant son exécution fermée", () => {
    const incomplete = planFixture();
    incomplete.missingContextQuestions = ["Quel contact ?"];

    expect(
      validateActionPlanProposal(incomplete, {
        role: "owner",
        grantedScopes: ["crm.contacts.read", "project.tasks.write"],
      }),
    ).toMatchObject({
      plan: {
        missingContextQuestions: ["Quel contact ?"],
      },
      requiresClarification: true,
      executionEnvironment: "mock",
      estimatedExternalCost: 0,
      approval: { mode: "single" },
      capabilities: [
        { name: "crm.contacts.search", environment: "mock" },
        { name: "project.task.create", environment: "mock" },
      ],
    });
    expect(() => validate(incomplete)).toThrowError(
      expect.objectContaining({ code: "orchestrator_plan_incomplete" }),
    );
  });

  it("applique aussi les garde-fous de sécurité aux propositions incomplètes", () => {
    const unavailable = incompletePlanFixture();
    unavailable.steps[0].capability = "calendar.event.delete";
    expect(() => validateProposal(unavailable)).toThrowError(
      expect.objectContaining({ code: "orchestrator_capability_unavailable" }),
    );

    const altered = incompletePlanFixture();
    altered.steps[1].requiresApproval = false;
    expect(() => validateProposal(altered)).toThrowError(
      expect.objectContaining({ code: "orchestrator_capability_mismatch" }),
    );

    const invalidInput = incompletePlanFixture();
    invalidInput.steps[0].input = { query: "" };
    expect(() => validateProposal(invalidInput)).toThrow();

    const forbiddenProvider = incompletePlanFixture();
    forbiddenProvider.steps[0].providerPreference = ["fournisseur_inconnu"];
    expect(() => validateProposal(forbiddenProvider)).toThrowError(
      expect.objectContaining({ code: "orchestrator_provider_not_allowed" }),
    );

    const paid = incompletePlanFixture();
    paid.estimatedCost = { amount: 1, currency: "EUR" };
    expect(() => validateProposal(paid)).toThrowError(
      expect.objectContaining({ code: "orchestrator_external_cost_forbidden" }),
    );

    expect(() =>
      validateActionPlanProposal(incompletePlanFixture(), {
        role: "owner",
        grantedScopes: ["crm.contacts.read"],
      }),
    ).toThrowError(
      expect.objectContaining({ code: "orchestrator_scope_missing" }),
    );

    expect(() =>
      validateActionPlanProposal(incompletePlanFixture(), {
        role: "read-only",
        grantedScopes: ["crm.contacts.read", "project.tasks.write"],
      }),
    ).toThrowError(
      expect.objectContaining({ code: "orchestrator_permission_denied" }),
    );
  });

  it("refuse un plan payant ou préparé en lecture seule", () => {

    const paid = planFixture();
    paid.estimatedCost = { amount: 1, currency: "EUR" };
    expect(() => validate(paid)).toThrowError(
      expect.objectContaining({ code: "orchestrator_external_cost_forbidden" }),
    );

    expect(() =>
      validateActionPlan(planFixture(), {
        role: "read-only",
        grantedScopes: ["crm.contacts.read", "project.tasks.write"],
      }),
    ).toThrowError(
      expect.objectContaining({ code: "orchestrator_permission_denied" }),
    );
  });
});

function validate(plan: ActionPlan) {
  return validateActionPlan(plan, {
    role: "owner",
    grantedScopes: ["crm.contacts.read", "project.tasks.write"],
  });
}

function validateProposal(plan: ActionPlan) {
  return validateActionPlanProposal(plan, {
    role: "owner",
    grantedScopes: ["crm.contacts.read", "project.tasks.write"],
  });
}

function incompletePlanFixture(): ActionPlan {
  const plan = planFixture();
  plan.missingContextQuestions = ["Quel contact ?"];
  return plan;
}

function planFixture(): ActionPlan {
  return {
    intent: "Préparer une relance commerciale",
    businessGoal: "Retrouver le contact puis créer une tâche de suivi",
    confidence: 0.96,
    missingContextQuestions: [],
    riskSummary: "Lecture locale puis création d'une tâche réversible.",
    estimatedCost: { amount: 0, currency: "EUR" },
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
