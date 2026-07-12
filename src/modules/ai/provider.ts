import OpenAI from "openai";
import { z } from "zod";
import { buildBusinessTwin, type OnboardingInput } from "@/lib/generation";

export const aiGenerationResultSchema = z.object({
  provider: z.string(),
  model: z.string(),
  promptVersion: z.string(),
  output: z.unknown(),
  usage: z.record(z.string(), z.unknown()),
  approvalStatus: z.enum(["draft", "approved", "rejected"]),
});

export type AiGenerationResult = z.infer<typeof aiGenerationResultSchema>;

export type AiProvider = {
  enrichBusinessTwin(input: OnboardingInput): Promise<AiGenerationResult>;
  generateFaqs(input: OnboardingInput): Promise<AiGenerationResult>;
  rewrite(input: { text: string; tone: string }): Promise<AiGenerationResult>;
};

export class DeterministicAiProvider implements AiProvider {
  async enrichBusinessTwin(input: OnboardingInput) {
    return aiGenerationResultSchema.parse({
      provider: "deterministic",
      model: "template-v1",
      promptVersion: "business-twin-v1",
      output: buildBusinessTwin(input),
      usage: {},
      approvalStatus: "draft",
    });
  }

  async generateFaqs(input: OnboardingInput) {
    return aiGenerationResultSchema.parse({
      provider: "deterministic",
      model: "template-v1",
      promptVersion: "faq-v1",
      output: [
        {
          question: "Comment prendre contact ?",
          answer: `Contactez ${input.companyName} par téléphone ou via le formulaire.`,
        },
      ],
      usage: {},
      approvalStatus: "draft",
    });
  }

  async rewrite(input: { text: string; tone: string }) {
    return aiGenerationResultSchema.parse({
      provider: "deterministic",
      model: "template-v1",
      promptVersion: "rewrite-v1",
      output: `${input.text}\n\nTon souhaité : ${input.tone}.`,
      usage: {},
      approvalStatus: "draft",
    });
  }
}

export class OpenAiProvider implements AiProvider {
  private client: OpenAI;

  constructor(apiKey = process.env.OPENAI_API_KEY) {
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is required for OpenAI provider.");
    }
    this.client = new OpenAI({ apiKey });
  }

  async enrichBusinessTwin(input: OnboardingInput) {
    const fallback = await new DeterministicAiProvider().enrichBusinessTwin(input);
    return aiGenerationResultSchema.parse({
      ...fallback,
      provider: "openai",
      model: process.env.OPENAI_MODEL ?? "gpt-5-mini",
      usage: { fallback: true },
    });
  }

  async generateFaqs(input: OnboardingInput) {
    return new DeterministicAiProvider().generateFaqs(input);
  }

  async rewrite(input: { text: string; tone: string }) {
    return new DeterministicAiProvider().rewrite(input);
  }
}

export function getAiProvider(): AiProvider {
  if (process.env.FEATURE_AI_GENERATION === "true" && process.env.OPENAI_API_KEY) {
    return new OpenAiProvider();
  }

  return new DeterministicAiProvider();
}
