import { afterEach, expect, it, vi } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import { createWebChannelAdapter } from "../src/modules/channels/web-channel";
import { createConversationModelPlan, getConversationModelReadiness, conversationModelName,
  conversationModelMaximumCostMicroUsd } from "../src/modules/orchestrator/model-runtime";
import type { CreateModelPlanInput } from "../src/modules/orchestrator/model-runtime";
import type { OpenAiPlanTransport } from "../src/modules/orchestrator/openai-generator";

const opened: Awaited<ReturnType<typeof createMemoryDb>>[] = [];
afterEach(async () => { await Promise.all(opened.splice(0).map((db) => db.close())); });
const environment = { FEATURE_CONVERSATION_MODEL: "true", OPENAI_API_KEY: "fixture-key-not-a-real-secret",
  OPENAI_MODEL: conversationModelName, CONVERSATION_MODEL_BUDGET_MICRO_USD: "100000" };

it("garde l'IA désactivée sans clé, consentement et budget dédiés", async () => {
  expect(getConversationModelReadiness({ FEATURE_AI_GENERATION: "true" }).state).toBe("disabled");
  expect(getConversationModelReadiness({ ...environment, OPENAI_API_KEY: "" }).state).toBe("missing_key");
  expect(getConversationModelReadiness({ ...environment, CONVERSATION_MODEL_BUDGET_MICRO_USD: "0" }).state).toBe("missing_budget");
  expect(getConversationModelReadiness({ ...environment, OPENAI_MODEL: "unreviewed-model" }).state).toBe("unsupported_model");
  const f = await fixture(); const transport = validTransport();
  await expect(createConversationModelPlan(f.db, f.user.id, f.tenant.id,
    { ...f.input, dataTransferApproved: false } as unknown as typeof f.input, { environment, transport })).rejects.toThrow();
  expect(transport.create).not.toHaveBeenCalled();
  expect((await f.db.query("select * from conversation_model_budget_charges")).rows).toHaveLength(0);
});

it("refuse un plafond d’organisation nul, invalide ou insuffisant sans réservation ni appel", async () => {
  const f = await fixture(); const transport = validTransport();
  for (const budget of ["0", "", "invalid", "-1", "1.5", "25000usd", "1000001", "24999"]) {
    const bounded = { ...environment, CONVERSATION_MODEL_TENANT_BUDGET_MICRO_USD: budget };
    expect(getConversationModelReadiness(bounded).state, `budget=${budget}`).toBe("missing_budget");
    await expect(createConversationModelPlan(f.db, f.user.id, f.tenant.id, f.input,
      { environment: bounded, transport })).rejects.toMatchObject({ code: "model_not_configured" });
  }
  expect(transport.create).not.toHaveBeenCalled();
  expect((await f.db.query("select * from conversation_model_budget_charges")).rows).toHaveLength(0);
  expect((await f.db.query("select * from conversation_model_requests")).rows).toHaveLength(0);
});

it("applique le plafond d’organisation autorisé indépendamment du budget global", async () => {
  const f = await fixture();
  const transport: OpenAiPlanTransport = { create: vi.fn(async () => { throw new Error("fixture_provider_failure"); }) };
  const bounded = { ...environment, CONVERSATION_MODEL_TENANT_BUDGET_MICRO_USD: "25000" };
  expect(getConversationModelReadiness(environment).state).toBe("ready");
  expect(getConversationModelReadiness(bounded).state).toBe("ready");
  await expect(createConversationModelPlan(f.db, f.user.id, f.tenant.id, f.input,
    { environment: bounded, transport })).rejects.toMatchObject({ code: "model_provider_unavailable" });
  await expect(createConversationModelPlan(f.db, f.user.id, f.tenant.id,
    { ...f.input, idempotencyKey: "model:tenant-budget-exhausted" },
    { environment: bounded, transport })).rejects.toMatchObject({ code: "model_not_authorized" });
  expect(transport.create).toHaveBeenCalledTimes(1);
  expect((await f.db.query("select * from conversation_model_budget_charges")).rows).toHaveLength(1);
});

it("réserve un budget, conserve une preuve modèle et rejoue sans nouvelle facturation", async () => {
  const f = await fixture(); const transport = validTransport();
  const first = await createConversationModelPlan(f.db, f.user.id, f.tenant.id, f.input, { environment, transport });
  const replay = await createConversationModelPlan(f.db, f.user.id, f.tenant.id, f.input, { environment, transport });
  expect(first.generationSource).toBe("model");
  expect(replay.id).toBe(first.id);
  expect(transport.create).toHaveBeenCalledTimes(1);
  expect(transport.create.mock.calls[0][0]).toMatchObject({ store: false, service_tier: "default", model: conversationModelName, max_output_tokens: 1024 });
  expect((await f.db.query("select * from conversation_model_budget_charges")).rows).toHaveLength(1);
  expect((await f.db.query<{ status: string; generation_snapshot: string }>("select status, generation_snapshot from conversation_model_requests")).rows[0])
    .toMatchObject({ status: "succeeded", generation_snapshot: expect.any(String) });
});

it("conserve la réservation après échec et refuse une nouvelle demande au-delà du plafond", async () => {
  const f = await fixture();
  const transport: OpenAiPlanTransport = { create: vi.fn(async () => { throw new Error("fixture_provider_failure"); }) };
  const bounded = { ...environment, CONVERSATION_MODEL_BUDGET_MICRO_USD: "25000" };
  await expect(createConversationModelPlan(f.db, f.user.id, f.tenant.id, f.input, { environment: bounded, transport })).rejects.toMatchObject({ code: "model_provider_unavailable" });
  await expect(createConversationModelPlan(f.db, f.user.id, f.tenant.id, { ...f.input, idempotencyKey: "model:second-request" }, { environment: bounded, transport }))
    .rejects.toMatchObject({ code: "model_not_authorized" });
  expect(transport.create).toHaveBeenCalledTimes(1);
  expect((await f.db.query("select * from conversation_model_budget_charges")).rows).toHaveLength(1);
  expect((await f.db.query<{ status: string }>("select status from conversation_model_requests")).rows[0].status).toBe("failed");
});

it("refuse les sources hors tenant avant tout appel au fournisseur", async () => {
  const f = await fixture(); const transport = validTransport();
  const other = await f.services.createTenant(f.user.id, { name: "Autre tenant IA", category: "Services" });
  await expect(createConversationModelPlan(f.db, f.user.id, other.id, f.input, { environment, transport })).rejects.toThrow();
  expect(transport.create).not.toHaveBeenCalled();
});

it("compte une demande en vol et conserve le débit de budget après effacement de sa sortie", async () => {
  const f = await fixture(); const valid = validTransport();
  let entered!: () => void; let release!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const transport: OpenAiPlanTransport = { create: vi.fn(async (request) => { entered(); await gate; return valid.create(request); }) };
  const bounded = { ...environment, CONVERSATION_MODEL_BUDGET_MICRO_USD: "25000" };
  const first = createConversationModelPlan(f.db, f.user.id, f.tenant.id, f.input, { environment: bounded, transport });
  await started;
  await expect(createConversationModelPlan(f.db, f.user.id, f.tenant.id,
    { ...f.input, idempotencyKey: "model:concurrent-request" }, { environment: bounded, transport })).rejects.toMatchObject({ code: "model_not_authorized" });
  release(); await first;
  await f.db.query("delete from conversation_model_requests");
  await expect(createConversationModelPlan(f.db, f.user.id, f.tenant.id,
    { ...f.input, idempotencyKey: "model:after-output-erasure" }, { environment: bounded, transport })).rejects.toMatchObject({ code: "model_not_authorized" });
  expect(transport.create).toHaveBeenCalledTimes(1);
  expect((await f.db.query("select * from conversation_model_budget_charges")).rows).toHaveLength(1);
});

function validTransport() {
  return { create: vi.fn<OpenAiPlanTransport["create"]>(async () => ({ status: "completed", model: conversationModelName,
    refused: false, inputTokens: 100, outputTokens: 100, outputText: JSON.stringify({ action: "prepare_follow_up",
      intent: "Préparer une relance", businessGoal: "Suivre le contact client", confidence: 0.9, questions: [],
      contactQuery: "client", taskTitle: "Rappeler le client", finalUserMessageDraft: "Je propose une recherche et une tâche de suivi à valider." }) })) };
}
async function fixture() {
  const db = await createMemoryDb(); opened.push(db); const services = createServices(db);
  const user = await services.registerUser({ name: "Responsable IA", email: "model-owner@example.test", password: "FixturePassword!1" });
  const tenant = await services.createTenant(user.id, { name: "Entreprise IA", category: "Services" });
  const thread = await createWebChannelAdapter(db).ingest(user.id, { tenantId: tenant.id, displayName: user.name,
    externalMessageId: "model-source", idempotencyKey: "model:ingress", correlationId: "model:fixture",
    text: "Prépare une relance du client", occurredAt: new Date().toISOString() });
  return { db, services, user, tenant, input: { threadId: thread.threadId, sourceMessageId: thread.messageId,
    idempotencyKey: "model:confirmed-request", dataTransferApproved: true as const,
    maximumCostMicroUsd: conversationModelMaximumCostMicroUsd } satisfies CreateModelPlanInput };
}
