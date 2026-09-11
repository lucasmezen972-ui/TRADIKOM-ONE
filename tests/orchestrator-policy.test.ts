import { describe, expect, it } from "vitest";
import { hashToken, toJson } from "../src/lib/security";
import { os3MockCapabilityManifest } from "../src/modules/connector-execution/capabilities";
import {
  compileConversationActionPlanPolicyReceipt,
  conversationActionPlanPolicyCatalogProjectionVersion,
  conversationActionPlanPolicyReceiptSchemaVersion,
  projectConversationActionPlanPolicyCatalog,
  resolveConversationPlanProviderPreference,
  validateActionPlan,
  verifyConversationActionPlanPolicyReceipt,
  type ActionPlan,
  type CompileConversationActionPlanPolicyReceiptInput,
  type ConversationActionPlanPolicyCatalogSource,
} from "../src/modules/orchestrator";

describe("policy pure des plans conversationnels", () => {
  it("ferme la préférence fournisseur sur l'unique runtime mock canonique", () => {
    expect(resolveConversationPlanProviderPreference()).toBe("tradikom_mock");
    expect(resolveConversationPlanProviderPreference([])).toBe(
      "tradikom_mock",
    );
    expect(
      resolveConversationPlanProviderPreference(["tradikom_mock"]),
    ).toBe("tradikom_mock");

    for (const forbidden of [
      ["fournisseur_inconnu"],
      ["tradikom_mock", "tradikom_mock"],
      ["tradikom_mock", "fournisseur_inconnu"],
    ]) {
      expect(() =>
        resolveConversationPlanProviderPreference(forbidden),
      ).toThrowError(
        expect.objectContaining({ code: "orchestrator_provider_not_allowed" }),
      );
    }
  });

  it("applique aussi l'allowlist pendant la validation des capacités", () => {
    const unknown = planFixture();
    unknown.steps[0].providerPreference = ["fournisseur_inconnu"];
    expect(() => validate(unknown)).toThrowError(
      expect.objectContaining({ code: "orchestrator_provider_not_allowed" }),
    );

    const multiple = planFixture();
    multiple.steps[0].providerPreference = [
      "tradikom_mock",
      "fournisseur_inconnu",
    ];
    expect(() => validate(multiple)).toThrowError(
      expect.objectContaining({ code: "orchestrator_provider_not_allowed" }),
    );
  });

  it("projette un catalogue canonique versionné sans sérialiser Zod", () => {
    const reversed = reversedCatalog();
    const projection = projectConversationActionPlanPolicyCatalog(reversed);
    const canonical = projectConversationActionPlanPolicyCatalog();

    expect(projection).toEqual(canonical);
    expect(projection).toMatchObject({
      projectionSchemaVersion:
        conversationActionPlanPolicyCatalogProjectionVersion,
      manifestSchemaVersion: 1,
      providerKey: "tradikom_mock",
      providerVersion: "1.0.0",
      executionEnvironment: "mock",
      status: "mock",
      auth: "none",
      allowedRoles: ["administrator", "collaborator", "manager", "owner"],
      capabilities: [
        { name: "crm.contacts.search", requiredScopes: ["crm.contacts.read"] },
        {
          name: "project.task.create",
          requiredScopes: ["project.tasks.write"],
        },
      ],
    });
    expect(toJson(projection)).not.toContain("inputSchema");
    expect(toJson(projection)).not.toContain("outputSchema");
    expect(Object.isFrozen(projection)).toBe(true);
    expect(Object.isFrozen(projection.capabilities)).toBe(true);
    expect(Object.isFrozen(projection.capabilities[0])).toBe(true);
    expect(Object.isFrozen(projection.capabilities[0]?.requiredScopes)).toBe(
      true,
    );

    reversed.capabilities[0]!.requiredScopes.push("scope.injecte");
    expect(toJson(projection)).not.toContain("scope.injecte");
  });

  it("compile un reçu déterministe, strict, trié et profondément immuable", () => {
    const firstInput = compileInput();
    const secondInput = {
      ...compileInput(),
      grantedScopes: ["project.tasks.write", "crm.contacts.read"],
      catalog: reversedCatalog(),
    };
    const first = compileConversationActionPlanPolicyReceipt(firstInput);
    const second = compileConversationActionPlanPolicyReceipt(secondInput);

    expect(first).toEqual(second);
    expect(first.fingerprint).toBe(hashToken(toJson(first.payload)));
    expect(first.payload).toMatchObject({
      schemaVersion: conversationActionPlanPolicyReceiptSchemaVersion,
      tenantId: "tenant_policy_1",
      plan: {
        id: "plan_policy_1",
        fingerprint: firstInput.planFingerprint,
      },
      approval: {
        mode: "single",
        id: "approval_policy_1",
        status: "approved",
      },
      provider: {
        key: "tradikom_mock",
        version: "1.0.0",
        executionEnvironment: "mock",
      },
      authorization: {
        role: "owner",
        allowedRoles: ["administrator", "collaborator", "manager", "owner"],
        requiredScopes: ["crm.contacts.read", "project.tasks.write"],
      },
      capabilities: ["crm.contacts.search", "project.task.create"],
      risk: {
        maximum: "medium",
        steps: [
          {
            stepId: "create_follow_up",
            capability: "project.task.create",
            level: "medium",
          },
          {
            stepId: "search_contact",
            capability: "crm.contacts.search",
            level: "low",
          },
        ],
      },
    });
    expect(first.payload.catalog.fingerprint).toBe(
      hashToken(toJson(first.payload.catalog.projection)),
    );
    expect(isDeeplyFrozen(first)).toBe(true);

    const mutableInput = planFixture();
    const detachedInput = compileInput(mutableInput);
    const detached = compileConversationActionPlanPolicyReceipt(detachedInput);
    mutableInput.steps[0].capability = "calendar.event.delete";
    expect(detached.payload.capabilities).toEqual([
      "crm.contacts.search",
      "project.task.create",
    ]);
  });

  it("vérifie le reçu courant et refuse toute falsification même ré-empreintée", () => {
    const input = compileInput();
    const receipt = compileConversationActionPlanPolicyReceipt(input);
    const verified = verifyConversationActionPlanPolicyReceipt(receipt, input);

    expect(verified).toEqual(receipt);
    expect(verified).not.toBe(receipt);
    expect(verified.payload).not.toBe(receipt.payload);
    expect(isDeeplyFrozen(verified)).toBe(true);

    const forgedPayload = JSON.parse(toJson(receipt.payload)) as Record<
      string,
      unknown
    >;
    const risk = forgedPayload.risk as Record<string, unknown>;
    risk.maximum = "critical";
    const forged = {
      payload: forgedPayload,
      fingerprint: hashToken(toJson(forgedPayload)),
    };
    expect(() =>
      verifyConversationActionPlanPolicyReceipt(forged, input),
    ).toThrowError(
      expect.objectContaining({ code: "orchestrator_policy_receipt_invalid" }),
    );
    expect(() =>
      verifyConversationActionPlanPolicyReceipt(undefined, input),
    ).toThrowError(
      expect.objectContaining({ code: "orchestrator_policy_receipt_invalid" }),
    );
  });

  it("échoue fermé sur toute dérive tenant, plan, validation, catalogue, rôle ou scope", () => {
    const input = compileInput();
    const receipt = compileConversationActionPlanPolicyReceipt(input);
    const changes: CompileConversationActionPlanPolicyReceiptInput[] = [
      { ...input, tenantId: "tenant_policy_2" },
      { ...input, planId: "plan_policy_2" },
      {
        ...input,
        approval: {
          mode: "single",
          id: "approval_policy_2",
          status: "approved",
        },
      },
      { ...input, role: "administrator" },
      { ...input, grantedScopes: ["crm.contacts.read"] },
      {
        ...input,
        catalog: {
          ...os3MockCapabilityManifest,
          providerVersion: "1.0.1",
        },
      },
    ];

    for (const changed of changes) {
      expect(() =>
        verifyConversationActionPlanPolicyReceipt(receipt, changed),
      ).toThrow();
    }
  });

  it("lie explicitement une capacité sans approbation à l'absence de validation", () => {
    const plan = planFixture();
    plan.steps = [plan.steps[0]!];
    const input = compileInput(plan, {
      approval: { mode: "none", id: null, status: "not_required" },
    });
    const receipt = compileConversationActionPlanPolicyReceipt(input);

    expect(receipt.payload.approval).toEqual({
      mode: "none",
      id: null,
      status: "not_required",
    });
    expect(receipt.payload.risk.maximum).toBe("low");
    expect(() =>
      compileConversationActionPlanPolicyReceipt({
        ...input,
        approval: {
          mode: "single",
          id: "approval_interdite",
          status: "approved",
        },
      }),
    ).toThrowError(
      expect.objectContaining({ code: "orchestrator_policy_receipt_invalid" }),
    );
  });

  it("refuse catalogue réel, coût externe et empreinte de plan incohérente", () => {
    const input = compileInput();
    expect(() =>
      compileConversationActionPlanPolicyReceipt({
        ...input,
        catalog: {
          ...os3MockCapabilityManifest,
          providerKey: "provider_reel",
        },
      }),
    ).toThrowError(
      expect.objectContaining({ code: "orchestrator_provider_not_allowed" }),
    );

    expect(() =>
      compileConversationActionPlanPolicyReceipt({
        ...input,
        planFingerprint: "0".repeat(64),
      }),
    ).toThrowError(
      expect.objectContaining({ code: "orchestrator_policy_receipt_invalid" }),
    );
  });
});

function validate(plan: ActionPlan) {
  return validateActionPlan(plan, {
    role: "owner",
    grantedScopes: ["crm.contacts.read", "project.tasks.write"],
  });
}

function compileInput(
  plan = planFixture(),
  overrides: Partial<CompileConversationActionPlanPolicyReceiptInput> = {},
): CompileConversationActionPlanPolicyReceiptInput {
  const planJson = toJson(plan);
  return {
    tenantId: "tenant_policy_1",
    planId: "plan_policy_1",
    planJson,
    planFingerprint: hashToken(planJson),
    approval: {
      mode: "single",
      id: "approval_policy_1",
      status: "approved",
    },
    role: "owner",
    grantedScopes: ["crm.contacts.read", "project.tasks.write"],
    ...overrides,
  };
}

function reversedCatalog(): ConversationActionPlanPolicyCatalogSource & {
  capabilities: Array<
    (typeof os3MockCapabilityManifest.capabilities)[number] & {
      requiredScopes: string[];
      dataCategories: string[];
    }
  >;
} {
  return {
    ...os3MockCapabilityManifest,
    capabilities: [...os3MockCapabilityManifest.capabilities]
      .reverse()
      .map((capability) => ({
        ...capability,
        requiredScopes: [...capability.requiredScopes].reverse(),
        dataCategories: [...capability.dataCategories].reverse(),
      })),
  };
}

function isDeeplyFrozen(value: unknown): boolean {
  if (value === null || typeof value !== "object") return true;
  if (!Object.isFrozen(value)) return false;
  return Object.values(value).every(isDeeplyFrozen);
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
        providerPreference: ["tradikom_mock"],
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
