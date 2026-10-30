import assert from "node:assert/strict";
import { describe, it } from "vitest";
import { defaultGarageOnboarding } from "../src/lib/generation";
import {
  DeterministicAiProvider,
  OpenAiProvider,
  getAiProvider,
} from "../src/modules/ai/provider";

describe("provenance réelle du fournisseur IA", () => {
  it("conserve la provenance et le contenu déterministes de l’enrichissement", async () => {
    const input = defaultGarageOnboarding();
    const expected = await new DeterministicAiProvider().enrichBusinessTwin(input);
    const actual = await new OpenAiProvider("unit-test-placeholder").enrichBusinessTwin(input);

    assert.deepEqual(actual, expected);
    assert.equal(actual.provider, "deterministic");
    assert.equal(actual.model, "template-v1");
    assert.equal(actual.promptVersion, "business-twin-v1");
    assert.equal(actual.approvalStatus, "draft");
  });

  it("conserve la provenance déterministe des FAQ", async () => {
    const input = defaultGarageOnboarding();
    const actual = await new OpenAiProvider("unit-test-placeholder").generateFaqs(input);
    assert.deepEqual(actual, await new DeterministicAiProvider().generateFaqs(input));
    assert.equal(actual.provider, "deterministic");
  });

  it("conserve la provenance déterministe de la réécriture", async () => {
    const input = { text: "Présentation de l’entreprise", tone: "direct" };
    const actual = await new OpenAiProvider("unit-test-placeholder").rewrite(input);
    assert.deepEqual(actual, await new DeterministicAiProvider().rewrite(input));
    assert.equal(actual.provider, "deterministic");
  });

  it("ne transforme pas un flag et une clé en preuve de génération OpenAI", async () => {
    const keys = ["FEATURE_AI_GENERATION", "OPENAI_API_KEY", "OPENAI_MODEL"] as const;
    const previous = keys.map((key) => process.env[key]);
    try {
      process.env.FEATURE_AI_GENERATION = "true";
      process.env.OPENAI_API_KEY = "unit-test-placeholder";
      process.env.OPENAI_MODEL = "modele-qui-ne-doit-pas-etre-attribue";
      const actual = await getAiProvider().enrichBusinessTwin(defaultGarageOnboarding());

      assert.equal(actual.provider, "deterministic");
      assert.equal(actual.model, "template-v1");
      assert.equal(Object.keys(actual.usage).length, 0);
      assert.equal(actual.approvalStatus, "draft");
      assert.ok(!JSON.stringify(actual).includes("unit-test-placeholder"));
    } finally {
      keys.forEach((key, index) => {
        if (previous[index] === undefined) delete process.env[key];
        else process.env[key] = previous[index];
      });
    }
  });

  it("ne sollicite aucun transport pour ces trois opérations de fallback", async () => {
    const previousFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = async () => {
      calls += 1;
      throw new Error("Le fallback ne doit pas appeler le réseau.");
    };
    try {
      const provider = new OpenAiProvider("unit-test-placeholder");
      const input = defaultGarageOnboarding();
      await provider.enrichBusinessTwin(input);
      await provider.generateFaqs(input);
      await provider.rewrite({ text: "Texte à relire", tone: "clair" });
      assert.equal(calls, 0);
    } finally {
      globalThis.fetch = previousFetch;
    }
  });

  it("refuse toujours une configuration OpenAI explicitement vide", () => {
    assert.throws(() => new OpenAiProvider(""), /OPENAI_API_KEY/);
  });
});
