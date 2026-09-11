import { describe, expect, it } from "vitest";
import {
  actionPlanProposalSchema,
  actionPlanSchema,
  generatedActionPlanEnvelopeSchema,
  type ActionPlan,
} from "../src/modules/orchestrator";

describe("schémas de l'orchestrateur", () => {
  it("valide un plan métier structuré avec deux capacités génériques", () => {
    const plan = planFixture();
    expect(actionPlanSchema.parse(plan)).toMatchObject({
      intent: "Préparer une relance commerciale",
      contextSources: [],
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

  it("borne les sources de contexte à des métadonnées sûres", () => {
    const source = {
      type: "external_untrusted_data" as const,
      sourceId: "attachment_context_1",
      sourceIntegrity: "verified" as const,
      truncated: false,
      instructionsAllowed: false as const,
      toolAccess: "forbidden" as const,
      policyMutation: "forbidden" as const,
    };
    const parsed = actionPlanSchema.parse({
      ...planFixture(),
      contextSources: [source],
    });

    expect(parsed.contextSources).toEqual([source]);
    expect(
      actionPlanSchema.safeParse({
        ...planFixture(),
        contextSources: [{ ...source, content: "contenu interdit" }],
      }).success,
    ).toBe(false);
    expect(
      actionPlanSchema.safeParse({
        ...planFixture(),
        contextSources: [source, source],
      }).success,
    ).toBe(false);
    expect(
      actionPlanSchema.safeParse({
        ...planFixture(),
        contextSources: Array.from({ length: 11 }, (_, index) => ({
          ...source,
          sourceId: `attachment_context_${index}`,
        })),
      }).success,
    ).toBe(false);
    expect(
      actionPlanSchema.safeParse({
        ...planFixture(),
        contextSources: [{ ...source, sourceIntegrity: "failed" }],
      }).success,
    ).toBe(false);
    expect(
      actionPlanSchema.safeParse({
        ...planFixture(),
        contextSources: [{ ...source, instructionsAllowed: true }],
      }).success,
    ).toBe(false);
    expect(
      actionPlanSchema.safeParse({
        ...planFixture(),
        contextSources: [{ ...source, toolAccess: "allowed" }],
      }).success,
    ).toBe(false);
    expect(
      actionPlanSchema.safeParse({
        ...planFixture(),
        contextSources: [{ ...source, policyMutation: "allowed" }],
      }).success,
    ).toBe(false);
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

  it("refuse les objets capables de modifier leur projection JSON", () => {
    const boxed = planFixture();
    boxed.steps[0].input = {
      payload: Object("CANARI-EXTERNE-BOITE-NE-PAS-PERSISTER"),
    };
    expect(actionPlanSchema.safeParse(boxed).success).toBe(false);

    const customSerialization = planFixture();
    customSerialization.steps[0].input = {
      payload: {
        toJSON() {
          return "CANARI-EXTERNE-TOJSON-NE-PAS-PERSISTER";
        },
      },
    };
    expect(actionPlanSchema.safeParse(customSerialization).success).toBe(false);
  });

  it("refuse les propriétés actives à la racine d'une entrée sans les exécuter", () => {
    let getterCalls = 0;
    let toJsonCalls = 0;
    const withGetter = planFixture();
    withGetter.steps[0].input = Object.defineProperty({}, "payload", {
      enumerable: true,
      get() {
        getterCalls += 1;
        return "CANARI-GETTER-NE-PAS-EXECUTER";
      },
    });

    const withToJson = planFixture();
    withToJson.steps[0].input = Object.defineProperty(
      { query: "contact" },
      "toJSON",
      {
        enumerable: false,
        value() {
          toJsonCalls += 1;
          return "CANARI-TOJSON-NE-PAS-EXECUTER";
        },
      },
    );

    expect(actionPlanSchema.safeParse(withGetter).success).toBe(false);
    expect(actionPlanSchema.safeParse(withToJson).success).toBe(false);
    expect(getterCalls).toBe(0);
    expect(toJsonCalls).toBe(0);
  });

  it("prévalide le plan entier avant de lire un accesseur", () => {
    let getterCalls = 0;
    const plan = Object.defineProperty(
      { ...planFixture() },
      "businessGoal",
      {
        enumerable: true,
        get() {
          getterCalls += 1;
          return "CANARI-PLAN-GETTER-NE-PAS-EXECUTER";
        },
      },
    );

    expect(actionPlanSchema.safeParse(plan).success).toBe(false);
    expect(getterCalls).toBe(0);
  });

  it("projette les descripteurs sans lire les traps get d'un Proxy", () => {
    let getterCalls = 0;
    const proxiedPlan = new Proxy(planFixture(), {
      get(target, key, receiver) {
        getterCalls += 1;
        return Reflect.get(target, key, receiver);
      },
    });
    const proxiedPlanResult = actionPlanSchema.safeParse(proxiedPlan);

    expect(proxiedPlanResult.success).toBe(true);
    expect(getterCalls).toBe(0);

    const planWithProxiedInput = planFixture();
    planWithProxiedInput.steps[0].input = new Proxy(
      { query: "contact sûr" },
      {
        get(target, key, receiver) {
          getterCalls += 1;
          if (key === "query") return () => "CANARI-GET-NE-PAS-PERSISTER";
          return Reflect.get(target, key, receiver);
        },
      },
    );
    const proxiedInputResult = actionPlanSchema.safeParse(planWithProxiedInput);

    expect(proxiedInputResult.success).toBe(true);
    expect(getterCalls).toBe(0);
    if (!proxiedInputResult.success) throw proxiedInputResult.error;
    expect(proxiedInputResult.data.steps[0]?.input).toEqual({
      query: "contact sûr",
    });
  });

  it("refuse une clé normalisée __proto__ sans polluer la sortie", () => {
    const plan = planFixture();
    plan.steps[0].input = JSON.parse(
      '{" __proto__ ":{"polluted":"CANARI-PROTOTYPE"}}',
    ) as Record<string, unknown>;

    expect(actionPlanSchema.safeParse(plan).success).toBe(false);
    expect(
      (Object.prototype as { polluted?: unknown }).polluted,
    ).toBeUndefined();
  });

  it("prévalide aussi l'enveloppe générée avant d'en lire les champs", () => {
    let getterCalls = 0;
    const envelope = Object.defineProperty(
      {
        generationSource: "model",
        modelReference: "modele-envelope-v1",
      },
      "plan",
      {
        enumerable: true,
        get() {
          getterCalls += 1;
          return planFixture();
        },
      },
    );

    expect(generatedActionPlanEnvelopeSchema.safeParse(envelope).success).toBe(
      false,
    );
    expect(getterCalls).toBe(0);
  });

  it("refuse prototypes et symboles à la racine d'une entrée", () => {
    const withCustomPrototype = planFixture();
    withCustomPrototype.steps[0].input = Object.assign(
      Object.create({ inherited: "interdit" }) as Record<string, unknown>,
      { query: "contact" },
    );

    const withSymbol = planFixture();
    const symbolInput: Record<string | symbol, unknown> = { query: "contact" };
    symbolInput[Symbol("payload")] = "CANARI-SYMBOLE-NE-PAS-PERSISTER";
    withSymbol.steps[0].input = symbolInput;

    expect(actionPlanSchema.safeParse(withCustomPrototype).success).toBe(false);
    expect(actionPlanSchema.safeParse(withSymbol).success).toBe(false);
  });

  it("refuse fermé une réflexion défaillante sans propager l'exception", () => {
    const plan = planFixture();
    plan.steps[0].input = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error("CANARI-REFLEXION-NE-PAS-PROPAGER");
        },
      },
    );

    expect(() => actionPlanSchema.safeParse(plan)).not.toThrow();
    expect(actionPlanSchema.safeParse(plan).success).toBe(false);

    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const planWithRevokedProxy = planFixture();
    planWithRevokedProxy.steps[0].input = revoked.proxy;

    expect(() => actionPlanSchema.safeParse(planWithRevokedProxy)).not.toThrow();
    expect(actionPlanSchema.safeParse(planWithRevokedProxy).success).toBe(false);
  });

  it("refuse les tableaux troués ou aux index incohérents", () => {
    const sparsePlan = planFixture();
    const sparseFragments = new Array<string>(2);
    sparseFragments[1] = "fragment";
    sparsePlan.steps[0].input = { fragments: sparseFragments };
    expect(actionPlanSchema.safeParse(sparsePlan).success).toBe(false);

    const virtualIndices = new Proxy(new Array<unknown>(2), {
      ownKeys() {
        return ["1", "100", "length"];
      },
      getOwnPropertyDescriptor(target, key) {
        if (key === "length") {
          return Reflect.getOwnPropertyDescriptor(target, key);
        }
        return {
          configurable: true,
          enumerable: true,
          writable: true,
          value: "fragment",
        };
      },
    });
    const proxyPlan = planFixture();
    proxyPlan.steps[0].input = { fragments: virtualIndices };

    expect(() => actionPlanSchema.safeParse(proxyPlan)).not.toThrow();
    expect(actionPlanSchema.safeParse(proxyPlan).success).toBe(false);
  });

  it("refuse sans exception une entrée JSON excessivement profonde", () => {
    const plan = planFixture();
    let nested: unknown = "feuille";
    for (let depth = 0; depth < 5_000; depth += 1) {
      nested = { nested };
    }
    plan.steps[0].input = { nested };

    expect(() => actionPlanSchema.safeParse(plan)).not.toThrow();
    expect(actionPlanSchema.safeParse(plan).success).toBe(false);
  });

  it("borne les chaînes et clés avant leur sérialisation", () => {
    const oversizedValuePlan = planFixture();
    oversizedValuePlan.steps[0].input = { value: "x".repeat(16_001) };
    expect(actionPlanSchema.safeParse(oversizedValuePlan).success).toBe(false);

    const oversizedKeyPlan = planFixture();
    oversizedKeyPlan.steps[0].input = {
      nested: { ["k".repeat(16_001)]: true },
    };
    expect(actionPlanSchema.safeParse(oversizedKeyPlan).success).toBe(false);
  });

  it("accepte les références partagées sérialisables mais refuse les cycles", () => {
    const sharedProviders: string[] = [];
    const sharedEvidence = ["Preuve métier partagée"];
    const planWithSharedValues = planFixture();
    for (const step of planWithSharedValues.steps) {
      step.providerPreference = sharedProviders;
      step.evidenceRequired = sharedEvidence;
    }

    expect(actionPlanSchema.safeParse(planWithSharedValues).success).toBe(true);

    const cyclicPlan = planFixture();
    const cyclicInput: Record<string, unknown> = {};
    cyclicInput.self = cyclicInput;
    cyclicPlan.steps[0].input = cyclicInput;

    expect(actionPlanSchema.safeParse(cyclicPlan).success).toBe(false);
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
