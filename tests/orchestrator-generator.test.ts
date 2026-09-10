import { describe, expect, it } from "vitest";
import {
  actionPlanSchema,
  assertGeneratedActionPlanDoesNotCopyExternalContext,
  boundActionPlanGenerationContextSources,
  createDeterministicActionPlanGenerator,
  type ValidatedActionPlan,
} from "../src/modules/orchestrator";

describe("générateur de plan OS-1", () => {
  it("produit un plan stable, structuré et sans recopier le message client", async () => {
    const generator = createDeterministicActionPlanGenerator();
    const context = {
      tenantId: "tenant_generator_1",
      threadId: "thread_generator_1",
      sourceMessageId: "message_generator_1",
      sourceText: "Mon code secret est CLIENT-SENSIBLE.",
    };
    const first = await generator.generate(context);
    const second = await generator.generate(context);

    expect(first).toEqual(second);
    expect(first.generationSource).toBe("deterministic_mock");
    expect(actionPlanSchema.parse(first.plan)).toMatchObject({
      contextSources: [],
      steps: expect.arrayContaining([
        expect.objectContaining({ capability: "crm.contacts.search" }),
      ]),
    });
    expect(JSON.stringify(first)).not.toContain("CLIENT-SENSIBLE");
    expect(first).not.toHaveProperty("execution");
  });

  it("refuse une source courte recopiée malgré la casse, les accents et la ponctuation", () => {
    const source = externalContextSource(
      "Référence confidentielle client Alpha-7788.",
    );
    const plan = validatedPlan({
      businessGoal: "xRÉFÉRENCE confidentielle : client alpha 7788y",
    });

    expect(() =>
      assertGeneratedActionPlanDoesNotCopyExternalContext(plan, [source]),
    ).toThrowError(
      expect.objectContaining({ code: "orchestrator_generated_plan_unsafe" }),
    );
  });

  it("refuse une séquence substantielle dans une entrée d'étape imbriquée", () => {
    const copiedText =
      "Le dossier bleu contient le budget de novembre et le calendrier privé du client Martinique";
    const source = externalContextSource(
      `Préambule sans intérêt. ${copiedText}. Note de fin.`,
    );
    const base = validatedPlan();
    const plan = validatedPlan({
      steps: [
        {
          ...base.steps[0]!,
          input: {
            filtre: {
              recherche:
                "LE DOSSIER BLEU contient le budget de novembre, et le calendrier privé du client Martinique",
            },
          },
        },
      ],
    });

    expect(() =>
      assertGeneratedActionPlanDoesNotCopyExternalContext(plan, [source]),
    ).toThrowError(
      expect.objectContaining({ code: "orchestrator_generated_plan_unsafe" }),
    );
  });

  it("inspecte aussi les clés imbriquées et la référence du modèle", () => {
    const denseCanary = "CANARIEXTERNE123456789012345678901234567890";
    const source = externalContextSource(
      `Donnée de contrôle ${denseCanary} à ne jamais recopier.`,
    );
    const base = validatedPlan();
    const planWithUnsafeKey = validatedPlan({
      steps: [
        {
          ...base.steps[0]!,
          input: {
            contextSources: {
              [denseCanary.toLocaleLowerCase("fr")]: true,
            },
          },
        },
      ],
    });

    expect(() =>
      assertGeneratedActionPlanDoesNotCopyExternalContext(planWithUnsafeKey, [
        source,
      ]),
    ).toThrowError(
      expect.objectContaining({ code: "orchestrator_generated_plan_unsafe" }),
    );
    expect(() =>
      assertGeneratedActionPlanDoesNotCopyExternalContext(
        validatedPlan({
          businessGoal: denseCanary.split("").join("-"),
        }),
        [source],
      ),
    ).toThrowError(
      expect.objectContaining({ code: "orchestrator_generated_plan_unsafe" }),
    );
    expect(() =>
      assertGeneratedActionPlanDoesNotCopyExternalContext(
        validatedPlan(),
        [source],
        [`modele:${denseCanary}`],
      ),
    ).toThrowError(
      expect.objectContaining({ code: "orchestrator_generated_plan_unsafe" }),
    );
  });

  it("refuse une copie répartie entre plusieurs champs ou autour de marqueurs masqués", () => {
    const chunks = [
      "A1b2C3d4E5f6G7h",
      "J8k9L0m1N2p3Q4r",
      "S5t6U7v8W9x0Y1z",
      "B2c3D4e5F6g7H8i",
    ];
    const chunkedSource = externalContextSource(chunks.join(" / "));
    expect(() =>
      assertGeneratedActionPlanDoesNotCopyExternalContext(
        validatedPlan({
          intent: chunks[0],
          businessGoal: chunks[1],
          riskSummary: chunks[2],
          finalUserMessageDraft: chunks[3],
        }),
        [chunkedSource],
      ),
    ).toThrowError(
      expect.objectContaining({ code: "orchestrator_generated_plan_unsafe" }),
    );

    const subThresholdChunks = [
      "abcde123456",
      "fghij234567",
      "klmno345678",
      "pqrst456789",
      "uvwxy567890",
    ];
    const subThresholdBase = validatedPlan();
    expect(() =>
      assertGeneratedActionPlanDoesNotCopyExternalContext(
        validatedPlan({
          steps: [
            {
              ...subThresholdBase.steps[0]!,
              input: { fragments: subThresholdChunks },
            },
          ],
        }),
        [externalContextSource(subThresholdChunks.join(""))],
      ),
    ).toThrowError(
      expect.objectContaining({ code: "orchestrator_generated_plan_unsafe" }),
    );

    const crossStepChunks = [
      "A1b2C3d4E5f",
      "G6h7J8k9L0m",
      "N1p2Q3r4S5t",
      "U6v7W8x9Y0z",
      "B1c2D3e4F5g",
    ];
    expect(() =>
      assertGeneratedActionPlanDoesNotCopyExternalContext(
        validatedPlan({
          steps: crossStepChunks.map((title, index) => ({
            ...subThresholdBase.steps[0]!,
            stepId: `prepare_follow_up_${index}`,
            input: { title },
            idempotencyKey: `plan:generator:prepare_follow_up_${index}`,
          })),
        }),
        [externalContextSource(crossStepChunks.join(""))],
      ),
    ).toThrowError(
      expect.objectContaining({ code: "orchestrator_generated_plan_unsafe" }),
    );

    const numericChunks = [
      123456789012345,
      234567890123456,
      345678901234567,
      456789012345678,
    ];
    const numericSource = externalContextSource(numericChunks.join(""));
    const base = validatedPlan();
    expect(() =>
      assertGeneratedActionPlanDoesNotCopyExternalContext(
        validatedPlan({
          steps: [
            {
              ...base.steps[0]!,
              input: { fragments: numericChunks },
            },
          ],
        }),
        [numericSource],
      ),
    ).toThrowError(
      expect.objectContaining({ code: "orchestrator_generated_plan_unsafe" }),
    );

    const bridgedSource = externalContextSource(
      "Lot alpha réservé au directeur [secret masqué] agenda bêta privé pour novembre",
    );
    expect(() =>
      assertGeneratedActionPlanDoesNotCopyExternalContext(
        validatedPlan({
          businessGoal:
            "Lot alpha réservé au directeur [secret masqué] agenda bêta privé pour novembre",
        }),
        [bridgedSource],
      ),
    ).toThrowError(
      expect.objectContaining({ code: "orchestrator_generated_plan_unsafe" }),
    );

    const punctuatedSource =
      "calendrier confidentiel client alpha budget novembre privé";
    expect(() =>
      assertGeneratedActionPlanDoesNotCopyExternalContext(
        validatedPlan({
          businessGoal: punctuatedSource.split("").join("-"),
        }),
        [externalContextSource(punctuatedSource)],
      ),
    ).toThrowError(
      expect.objectContaining({ code: "orchestrator_generated_plan_unsafe" }),
    );

    const unicodeCaseSource = "abcdeßfghijßklmnoßpqrstßuvwxyßz1234";
    expect(() =>
      assertGeneratedActionPlanDoesNotCopyExternalContext(
        validatedPlan({ businessGoal: unicodeCaseSource.toUpperCase() }),
        [externalContextSource(unicodeCaseSource)],
      ),
    ).toThrowError(
      expect.objectContaining({ code: "orchestrator_generated_plan_unsafe" }),
    );

    const jsonPayload = {
      A1b2C3d4E5f: "G6h7J8k9L0m",
      N1p2Q3r4S5t: "U6v7W8x9Y0z",
      B1c2D3e4F5g: "H6i7J8k9L0n",
    };
    const jsonBase = validatedPlan();
    expect(() =>
      assertGeneratedActionPlanDoesNotCopyExternalContext(
        validatedPlan({
          steps: [
            {
              ...jsonBase.steps[0]!,
              input: jsonPayload,
            },
          ],
        }),
        [externalContextSource(JSON.stringify(jsonPayload))],
      ),
    ).toThrowError(
      expect.objectContaining({ code: "orchestrator_generated_plan_unsafe" }),
    );
  });

  it("applique explicitement le seuil de copie complète à 32 caractères", () => {
    const belowThreshold = "a".repeat(31);
    expect(() =>
      assertGeneratedActionPlanDoesNotCopyExternalContext(
        validatedPlan({ businessGoal: belowThreshold }),
        [externalContextSource(belowThreshold)],
      ),
    ).not.toThrow();

    const atThreshold = "b".repeat(32);
    expect(() =>
      assertGeneratedActionPlanDoesNotCopyExternalContext(
        validatedPlan({ businessGoal: atThreshold }),
        [externalContextSource(atThreshold)],
      ),
    ).toThrowError(
      expect.objectContaining({ code: "orchestrator_generated_plan_unsafe" }),
    );
  });

  it("accepte les marqueurs masqués, un fait court dérivé et le plan déterministe", async () => {
    const maskedSource = externalContextSource(
      [
        "[secret masqué]",
        "[lien masqué]",
        "[adresse interne masquée]",
        "[contenu masqué]",
      ].join(" "),
    );
    const safePlan = validatedPlan({
      businessGoal:
        "Conserver les marqueurs [secret masqué] et [lien masqué] sans contenu brut.",
    });
    expect(() =>
      assertGeneratedActionPlanDoesNotCopyExternalContext(safePlan, [maskedSource]),
    ).not.toThrow();

    const factualSource = externalContextSource(
      "Le client en Martinique souhaite une analyse détaillée de son dossier historique privé.",
    );
    expect(() =>
      assertGeneratedActionPlanDoesNotCopyExternalContext(
        validatedPlan({ businessGoal: "Suivre le client en Martinique." }),
        [factualSource],
      ),
    ).not.toThrow();

    const repeatedChunk = "abcdefghijklmnop";
    expect(() =>
      assertGeneratedActionPlanDoesNotCopyExternalContext(
        validatedPlan({ businessGoal: repeatedChunk }),
        [externalContextSource(repeatedChunk.repeat(4))],
      ),
    ).not.toThrow();
    expect(() =>
      assertGeneratedActionPlanDoesNotCopyExternalContext(
        validatedPlan({
          intent: repeatedChunk,
          businessGoal: repeatedChunk,
          riskSummary: repeatedChunk,
        }),
        [externalContextSource(repeatedChunk.repeat(4))],
      ),
    ).toThrowError(
      expect.objectContaining({ code: "orchestrator_generated_plan_unsafe" }),
    );

    const shortDerivedFact = "FACTURECLIENTALPHA1234567";
    expect(() =>
      assertGeneratedActionPlanDoesNotCopyExternalContext(
        validatedPlan({ businessGoal: shortDerivedFact }),
        [
          externalContextSource(
            `PREFIXE${shortDerivedFact}SUFFIXEPLUSLONGUE`,
          ),
        ],
      ),
    ).not.toThrow();

    const repeatedStructuralBase = validatedPlan();
    const repeatedStructuralPlan = validatedPlan({
      steps: [
        {
          ...repeatedStructuralBase.steps[0]!,
          stepId: "search_structural_contact",
          capability: "crm.contacts.search",
          risk: "low",
          requiresApproval: false,
          idempotencyKey: "plan:generator:search_structural_contact",
        },
        repeatedStructuralBase.steps[0]!,
      ],
    });
    expect(() =>
      assertGeneratedActionPlanDoesNotCopyExternalContext(
        repeatedStructuralPlan,
        [
          externalContextSource(
            "Documentation technique : crm contacts search, project task create, medium, true et false.",
          ),
        ],
      ),
    ).not.toThrow();

    const generator = createDeterministicActionPlanGenerator();
    const generated = await generator.generate({
      tenantId: "tenant_generator_guard",
      threadId: "thread_generator_guard",
      sourceMessageId: "message_generator_guard",
      sourceText: "Prépare un suivi.",
      contextSources: [factualSource],
    });
    expect(() =>
      assertGeneratedActionPlanDoesNotCopyExternalContext(
        actionPlanSchema.parse(generated.plan),
        [factualSource],
      ),
    ).not.toThrow();
  });

  it("borne purement le contenu en mémoire et ne conserve que les métadonnées", async () => {
    const sources = Array.from({ length: 10 }, (_, index) => ({
      type: "external_untrusted_data" as const,
      sourceId: `attachment_generator_${index}`,
      sourceIntegrity: "verified" as const,
      truncated: false,
      instructionsAllowed: false as const,
      toolAccess: "forbidden" as const,
      policyMutation: "forbidden" as const,
      content: `${index}:`.padEnd(3_000, "x"),
    }));

    const bounded = boundActionPlanGenerationContextSources(sources);
    expect(bounded).toHaveLength(6);
    expect(bounded.reduce((total, source) => total + source.content.length, 0)).toBe(
      16_000,
    );
    expect(bounded.every((source) => source.content.length > 0)).toBe(true);
    expect(bounded.at(-1)).toMatchObject({
      sourceId: "attachment_generator_5",
      content: expect.stringMatching(/^5:x+$/),
      truncated: true,
    });
    const generated = await createDeterministicActionPlanGenerator().generate({
      tenantId: "tenant_generator_context",
      threadId: "thread_generator_context",
      sourceMessageId: "message_generator_context",
      sourceText: null,
      contextSources: bounded,
    });
    const persisted = actionPlanSchema.parse(generated.plan);
    expect(persisted.contextSources).toHaveLength(6);
    expect(persisted.contextSources.map((source) => source.sourceId)).toEqual(
      bounded.map((source) => source.sourceId),
    );
    expect(JSON.stringify(persisted.contextSources)).not.toContain("content");

    const fullBudgetThenEmpty = boundActionPlanGenerationContextSources([
      { ...sources[0]!, content: "x".repeat(16_000) },
      { ...sources[1]!, content: "" },
    ]);
    expect(fullBudgetThenEmpty).toHaveLength(1);
    expect(fullBudgetThenEmpty[0]?.sourceId).toBe("attachment_generator_0");

    expect(() =>
      boundActionPlanGenerationContextSources([
        ...sources,
        { ...sources[0]!, sourceId: "attachment_generator_10" },
      ]),
    ).toThrowError(
      expect.objectContaining({ code: "orchestrator_source_context_invalid" }),
    );
  });
});

function validatedPlan(
  overrides: Partial<ValidatedActionPlan> = {},
): ValidatedActionPlan {
  return actionPlanSchema.parse({
    intent: "Préparer un suivi commercial",
    businessGoal: "Organiser une prochaine action utile.",
    confidence: 0.8,
    missingContextQuestions: [],
    contextSources: [],
    riskSummary: "Une action réversible reste soumise à validation.",
    estimatedCost: { amount: 0, currency: "EUR" },
    steps: [
      {
        stepId: "prepare_follow_up",
        capability: "project.task.create",
        providerPreference: [],
        input: { title: "Préparer le suivi" },
        risk: "medium",
        requiresApproval: true,
        reversible: true,
        evidenceRequired: ["Référence de la tâche mock"],
        idempotencyKey: "plan:generator:prepare_follow_up",
      },
    ],
    finalUserMessageDraft:
      "Je propose de préparer une action de suivi soumise à validation.",
    ...overrides,
  });
}

function externalContextSource(content: string) {
  return {
    type: "external_untrusted_data" as const,
    sourceId: "attachment_generator_guard",
    sourceIntegrity: "verified" as const,
    truncated: false,
    instructionsAllowed: false as const,
    toolAccess: "forbidden" as const,
    policyMutation: "forbidden" as const,
    content,
  };
}
