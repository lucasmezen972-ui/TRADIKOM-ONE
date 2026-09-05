import { describe, expect, it } from "vitest";
import {
  validateActionPlan,
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

  it("refuse un plan incomplet, payant ou préparé en lecture seule", () => {
    const incomplete = planFixture();
    incomplete.missingContextQuestions = ["Quel contact ?"];
    expect(() => validate(incomplete)).toThrowError(
      expect.objectContaining({ code: "orchestrator_plan_incomplete" }),
    );

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
