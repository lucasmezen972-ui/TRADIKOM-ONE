import { describe, expect, it, vi } from "vitest";
import {
  createConfiguredConversationModelGenerator,
  type ConversationModelAuthorization,
  type ConversationModelAuthorizationRequest,
  type ConversationModelOutcome,
  type OpenAiPlanResponse,
  type OpenAiPlanTransport,
} from "../src/modules/orchestrator/openai-generator";

const context = {
  tenantId: "tenant_model_test",
  threadId: "thread_model_test",
  sourceMessageId: "message_model_test",
  sourceText: "Préparer une relance commerciale pour le contact.",
};
const config = {
  enabled: true,
  apiKey: "unit-test-not-a-real-key",
  model: "model-approved",
  maximumOutputTokens: 1_024,
};

function draft() {
  return {
    action: "prepare_follow_up",
    intent: "Préparer une relance",
    businessGoal: "Préparer un suivi commercial contrôlé.",
    confidence: 0.9,
    questions: [],
    contactQuery: "contact lié à la conversation",
    taskTitle: "Préparer le prochain suivi",
    finalUserMessageDraft: "Voici un brouillon de plan à valider.",
  };
}
function response(): OpenAiPlanResponse {
  return {
    status: "completed",
    model: "model-approved-snapshot",
    outputText: JSON.stringify(draft()),
    refused: false,
    inputTokens: 300,
    outputTokens: 100,
  };
}
function authorization(
  request: ConversationModelAuthorizationRequest,
): ConversationModelAuthorization {
  return {
    reservationId: "reservation_model_test",
    tenantId: request.tenantId,
    threadId: request.threadId,
    sourceMessageId: request.sourceMessageId,
    model: request.model,
    dataTransferApproved: true,
    externalContextApproved: request.includesExternalContext,
    maximumInputBytes: request.maximumInputBytes,
    maximumOutputTokens: request.maximumOutputTokens,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}
function setup() {
  const create = vi.fn<OpenAiPlanTransport["create"]>()
    .mockResolvedValue(response());
  const authorizeAndReserve = vi.fn<
    (request: ConversationModelAuthorizationRequest) =>
      Promise<ConversationModelAuthorization | null>
  >().mockImplementation(async (request) => authorization(request));
  const recordOutcome = vi.fn<
    (authorization: ConversationModelAuthorization, outcome: ConversationModelOutcome) =>
      Promise<void>
  >().mockResolvedValue(undefined);
  const dependencies = { transport: { create }, authorizeAndReserve, recordOutcome };
  return {
    create,
    authorizeAndReserve,
    recordOutcome,
    dependencies,
    generator: createConfiguredConversationModelGenerator(config, dependencies),
  };
}

describe("adaptateur modèle Conversation préparé, sans activation implicite", () => {
  it("garde le générateur déterministe quand le flag est désactivé", async () => {
    const test = setup();
    const generator = createConfiguredConversationModelGenerator(
      { enabled: false },
      test.dependencies,
    );
    const result = await generator.generate(context);
    expect(result.generationSource).toBe("deterministic_mock");
    expect(test.authorizeAndReserve).not.toHaveBeenCalled();
    expect(test.create).not.toHaveBeenCalled();
    expect(test.recordOutcome).not.toHaveBeenCalled();
  });

  it("refuse un flag seul sans configuration et résolution d’autorisation", async () => {
    const generator = createConfiguredConversationModelGenerator({ enabled: true });
    await expect(generator.generate(context)).rejects.toMatchObject({
      code: "model_not_configured",
    });
  });

  it("refuse avant transport une autorisation absente ou un contexte trop volumineux", async () => {
    const test = setup();
    test.authorizeAndReserve.mockResolvedValue(null);
    await expect(test.generator.generate(context)).rejects.toMatchObject({
      code: "model_not_authorized",
    });
    await expect(test.generator.generate({
      ...context, sourceText: "x".repeat(8_001),
    })).rejects.toMatchObject({ code: "model_input_invalid" });
    expect(test.create).not.toHaveBeenCalled();
    expect(test.recordOutcome).not.toHaveBeenCalled();
  });

  it.each(["tenantId", "threadId", "sourceMessageId", "model"] as const)(
    "refuse une réservation visant un autre %s",
    async (key) => {
      const test = setup();
      test.authorizeAndReserve.mockImplementation(async (request) => ({
        ...authorization(request), [key]: "another_target",
      }));
      await expect(test.generator.generate(context)).rejects.toMatchObject({
        code: "model_not_authorized",
      });
      expect(test.create).not.toHaveBeenCalled();
    },
  );

  it("refuse une réservation expirée sans déclencher de requête", async () => {
    const test = setup();
    test.authorizeAndReserve.mockImplementation(async (request) => ({
      ...authorization(request), expiresAt: "2000-01-01T00:00:00.000Z",
    }));
    await expect(test.generator.generate(context)).rejects.toMatchObject({
      code: "model_not_authorized",
    });
    expect(test.create).not.toHaveBeenCalled();
  });

  it("produit seulement un brouillon validé et les deux capacités mock serveur", async () => {
    const test = setup();
    const result = await test.generator.generate(context);
    expect(result).toMatchObject({
      generationSource: "model",
      modelReference: "openai:model-approved-snapshot:conversation-follow-up-v1",
      plan: {
        estimatedCost: { amount: 0, currency: "EUR" },
        steps: [
          { capability: "crm.contacts.search", risk: "low", requiresApproval: false },
          { capability: "project.task.create", risk: "medium", requiresApproval: true },
        ],
      },
    });
    expect(result).not.toHaveProperty("execution");
    const request = test.create.mock.calls[0]![0];
    expect(request).toMatchObject({
      model: config.model,
      store: false,
      max_output_tokens: config.maximumOutputTokens,
      text: { format: { type: "json_schema", strict: true } },
    });
    expect(request).not.toHaveProperty("tools");
    expect(request.input).not.toContain(context.tenantId);
    expect(request.input).not.toContain(context.threadId);
    expect(test.recordOutcome).toHaveBeenCalledWith(
      expect.objectContaining({ reservationId: "reservation_model_test" }),
      {
        status: "succeeded",
        reason: "valid_draft",
        responseModel: "model-approved-snapshot",
        inputTokens: 300,
        outputTokens: 100,
      },
    );
    expect(JSON.stringify(test.recordOutcome.mock.calls))
      .not.toContain(config.apiKey);
  });

  it.each([
    { ...response(), status: "incomplete" },
    { ...response(), refused: true },
    { ...response(), outputText: "pas du JSON" },
    { ...response(), outputText: "x".repeat(64_001) },
    { ...response(), outputText: JSON.stringify({ ...draft(), execution: true }) },
  ])("refuse une réponse incomplète, refusée ou non conforme", async (invalid) => {
    const test = setup();
    test.create.mockResolvedValue(invalid);
    await expect(test.generator.generate(context)).rejects.toMatchObject({
      code: "model_output_invalid",
    });
    expect(test.recordOutcome).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "failed", reason: "invalid_output" }),
    );
  });

  it.each(["contactQuery", "taskTitle"] as const)(
    "refuse un JSON valide dont %s dépasse les 200 caractères du manifeste",
    async (key) => {
      const test = setup();
      test.create.mockResolvedValue({
        ...response(),
        outputText: JSON.stringify({ ...draft(), [key]: "x".repeat(201) }),
      });
      await expect(test.generator.generate(context)).rejects.toMatchObject({
        code: "model_output_invalid",
      });
      expect(test.recordOutcome).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ status: "failed", reason: "invalid_output" }),
      );
    },
  );

  it("accepte les inputs à la borne du manifeste et conserve cette borne dans le contrat OpenAI", async () => {
    const test = setup();
    test.create.mockResolvedValue({
      ...response(),
      outputText: JSON.stringify({
        ...draft(), contactQuery: "x".repeat(200), taskTitle: "y".repeat(200),
      }),
    });
    const result = await test.generator.generate(context);
    expect(result.generationSource).toBe("model");
    const schema = test.create.mock.calls[0]![0].text.format.schema;
    expect(schema).toMatchObject({
      properties: {
        contactQuery: { maxLength: 200 },
        taskTitle: { maxLength: 200 },
      },
    });
  });

  it("ne transmet les sources externes qu’après consentement dédié et refuse leur recopie", async () => {
    const sensitive = "CANARISECRETPRIVE123456789012345678901234567890";
    const externalContext = {
      ...context,
      contextSources: [{
        type: "external_untrusted_data" as const,
        sourceId: "attachment_model_test",
        sourceIntegrity: "verified" as const,
        truncated: false,
        instructionsAllowed: false as const,
        toolAccess: "forbidden" as const,
        policyMutation: "forbidden" as const,
        content: sensitive,
      }],
    };
    const denied = setup();
    denied.authorizeAndReserve.mockImplementation(async (request) => ({
      ...authorization(request), externalContextApproved: false,
    }));
    await expect(denied.generator.generate(externalContext))
      .rejects.toMatchObject({ code: "model_not_authorized" });
    expect(denied.create).not.toHaveBeenCalled();

    const copied = setup();
    copied.create.mockResolvedValue({
      ...response(),
      outputText: JSON.stringify({ ...draft(), businessGoal: sensitive }),
    });
    await expect(copied.generator.generate(externalContext))
      .rejects.toMatchObject({ code: "model_output_invalid" });
    expect(JSON.stringify(copied.recordOutcome.mock.calls)).not.toContain(sensitive);
  });

  it("n’expose pas l’erreur brute du fournisseur et n’effectue aucun retry applicatif", async () => {
    const test = setup();
    test.create.mockRejectedValue(new Error("réponse privée du fournisseur"));
    const error = await test.generator.generate(context).catch((failure) => failure);
    expect(error).toMatchObject({ code: "model_provider_unavailable" });
    expect(String(error)).not.toContain("réponse privée");
    expect(test.create).toHaveBeenCalledTimes(1);
    expect(test.recordOutcome).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ status: "failed", reason: "provider_failure" }),
    );
  });

  it("ne retourne pas de plan si la preuve de génération ne peut pas être enregistrée", async () => {
    const test = setup();
    test.recordOutcome.mockRejectedValue(new Error("stockage indisponible"));
    await expect(test.generator.generate(context)).rejects.toMatchObject({
      code: "model_audit_unavailable",
    });
  });
});
