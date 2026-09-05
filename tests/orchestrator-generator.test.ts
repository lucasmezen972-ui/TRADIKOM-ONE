import { describe, expect, it } from "vitest";
import {
  actionPlanSchema,
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
    expect(actionPlanSchema.parse(first.plan).steps).toHaveLength(2);
    expect(JSON.stringify(first)).not.toContain("CLIENT-SENSIBLE");
    expect(first).not.toHaveProperty("execution");
  });
});
