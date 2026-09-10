import { describe, expect, it } from "vitest";
import {
  actionPlanSchema,
  boundActionPlanGenerationContextSources,
  createDeterministicActionPlanGenerator,
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
