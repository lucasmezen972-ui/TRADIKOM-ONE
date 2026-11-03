import { afterAll, beforeAll, beforeEach, expect, it, vi, type MockInstance } from "vitest";
import type { SqlTransactionContext } from "../src/db/client";
import { createMemoryDb, type DbClient } from "../src/lib/db";
import { defaultGarageOnboarding } from "../src/lib/generation";
import { nowIso } from "../src/lib/security";
import { createServices } from "../src/lib/services";
import { getConversationThread, ingestConversationMessage } from "../src/modules/conversation-hub";
import {
  createConversationActionPlan,
  decideConversationActionPlan,
  delegateConversationActionPlan,
  executeConversationActionPlan,
  getConversationActionPlan,
  reviseConversationActionPlan,
} from "../src/modules/orchestrator";
import { createWhatsAppMetaSecretResolvers, createWhatsAppTwilioSecretResolvers } from "../src/modules/channels/channel-provider-secrets-service";
import { prepareConnectorInstallationPlan } from "../src/modules/universal-connectors";
import { getWorkflowQueueOverview } from "../src/modules/workflows";

let db: Awaited<ReturnType<typeof createMemoryDb>>;
let runtime: DbClient;
let services: ReturnType<typeof createServices>;
let ownerId: string;
let managerId: string;
let outsiderId: string;
let tenantId: string;
let threadId: string;
let sourceMessageId: string;
const contexts: SqlTransactionContext[] = [];
const statements: string[] = [];
let fetchSpy: MockInstance<typeof fetch>;

beforeAll(async () => {
  db = await createMemoryDb();
  const setup = createServices(db);
  const owner = await setup.registerUser({ name: "Requête unique", email: "single-flight-owner@example.test", password: "FixturePassword!1" });
  const manager = await setup.registerUser({ name: "Responsable", email: "single-flight-manager@example.test", password: "FixturePassword!1" });
  const outsider = await setup.registerUser({ name: "Compte tiers", email: "single-flight-outsider@example.test", password: "FixturePassword!1" });
  ownerId = owner.id; managerId = manager.id; outsiderId = outsider.id;
  const tenant = await setup.createTenant(owner.id, { name: "Entreprise requête unique", category: "Services" });
  tenantId = tenant.id;
  await db.query("insert into memberships (tenant_id,user_id,role,created_at) values ($1,$2,'manager',$3)", [tenantId, managerId, nowIso()]);
  await setup.saveOnboarding(ownerId, tenantId, defaultGarageOnboarding());
  await setup.createBusinessBrainEntry(ownerId, tenantId, {
    domain: "margins", title: "Marge mensuelle contrôlée", summary: "La direction suit une marge déclarée chaque mois.", details: "", confidence: 90,
    sourceType: "manual", evidenceType: "document", evidenceSummary: "Compte-rendu interne approuvé par la direction.",
  });
  await setup.recordFinancialInputSnapshot(ownerId, tenantId, {
    period: "2026-10", monthlyRevenueCents: 100000, operatingCostsCents: 80000, cashBalanceCents: 20000,
    cashInflowsCents: 100000, cashOutflowsCents: 80000, receivablesCents: 1000, payablesCents: 1000,
    marketingSpendCents: 1000, salesSpendCents: 1000, websiteSpendCents: 1000, automationSpendCents: 1000,
    newCustomers: 2, activeCustomers: 10, evidenceSummary: "Relevé de gestion interne confirmé pour la recette.",
  });
  const competitor = await setup.createCompetitorProfile(ownerId, tenantId, { name: "Entreprise publique fictive", websiteUrl: "https://competitor.example.test/" });
  await setup.createCompetitorObservation(ownerId, tenantId, {
    competitorId: competitor.competitorId, category: "price", direction: "increase", sourceType: "official_website",
    sourceUrl: "https://competitor.example.test/pricing", title: "Prix public fictif", summary: "Le forfait public de démonstration passe à cent euros.",
    observedValue: "100 EUR", observedAt: "2026-10-01T10:00:00.000Z", publicSourceConfirmed: true, protectedContentExcluded: true,
  });
  await db.query("update connectors set health='warning',status='Connecté' where tenant_id=$1", [tenantId]);
  await setup.createUniversalExport(ownerId, tenantId, {
    entityType: "contacts", format: "csv", selectedFields: ["name"], dateFrom: "2026-01-01T00:00:00.000Z", dateTo: "2026-12-31T23:59:59.999Z",
  });
  const timestamp = "2026-10-01T10:00:00.000Z";
  const source = await ingestConversationMessage(db, ownerId, {
    tenantId, channelIdentity: {
      id: "identity_single_flight", tenantId, participantId: "participant_single_flight", channelKind: "web", adapterKey: "web-chat",
      externalSubjectId: "member_single_flight", displayName: "Membre fictif", role: "member", state: "active", createdAt: timestamp, updatedAt: timestamp,
    },
    externalMessageId: "external_single_flight", idempotencyKey: "ingress:web:single-flight", correlationId: "correlation_single_flight",
    routeTrace: [{ adapterKey: "web-chat", channelIdentityId: "identity_single_flight", externalMessageId: "external_single_flight" }],
    text: "Préparer une relance commerciale pour ce contact.",
    attachments: [{ id: "attachment_single_flight", kind: "document", fileName: "fixture.txt", mediaType: "text/plain", sizeBytes: 10,
      storageReference: `${tenantId}/conversations/attachment_single_flight`, checksumSha256: "a".repeat(64) }], occurredAt: timestamp,
  });
  threadId = source.threadId; sourceMessageId = source.messageId;
  runtime = {
    __runtime: "postgres", query: (sql: string, params?: unknown[]) => db.query(sql, params),
    __withTransaction: (context: SqlTransactionContext, callback: (tx: DbClient) => Promise<unknown>) => db.transaction(async tx => {
      contexts.push(context);
      if (context.tenantId) await tx.query("select set_config('app.tenant_id',$1,true)", [context.tenantId]);
      if (context.actorId) await tx.query("select set_config('app.actor_id',$1,true)", [context.actorId]);
      if (context.systemAccess) await tx.query("select set_config('app.system_access','true',true)");
      let active: Promise<unknown> | undefined;
      const transaction = {
        __runtime: "postgres", __transaction: true,
        async query<T>(sql: string, params?: unknown[]) {
          if (active) {
            // Finish the first SQL operation before surfacing the overlap, so a
            // failing regression cannot race its own transaction rollback.
            await active.catch(() => undefined);
            throw new Error("single_connection_query_overlap");
          }
          statements.push(sql);
          const pending = Promise.resolve().then(() => tx.query<T>(sql, params));
          active = pending;
          try { return await pending; }
          finally { if (active === pending) active = undefined; }
        },
      } as DbClient;
      return callback(transaction);
    }),
  } as unknown as DbClient;
  services = createServices(runtime);
  fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("Aucun appel réseau attendu"));
}, 60000);

beforeEach(() => { contexts.length = 0; statements.length = 0; });
afterAll(async () => { vi.restoreAllMocks(); if (db) await db.close(); });

it("recharge le vrai fil, messages, pièces jointes et provenance sur une seule connexion", async () => {
  const thread = await getConversationThread(runtime, ownerId, tenantId, threadId);
  expect(thread.id).toBe(threadId);
  expect(thread.messages[0]?.attachments[0]?.id).toBe("attachment_single_flight");
  expect(thread.messages[0]?.provenance.routeTrace[0]?.adapterKey).toBe("web-chat");
  await expect(getConversationThread(runtime, outsiderId, tenantId, threadId)).rejects.toMatchObject({ code: "tenant_access_denied" });
  expect(contexts.map(context => context.actorId)).toEqual([ownerId, outsiderId]);
  expect(contexts.every(context => context.tenantId === tenantId && !context.systemAccess)).toBe(true);
});

it("lit résumé et événements réels de la file sans chevauchement ni drainage", async () => {
  const overview = await getWorkflowQueueOverview(runtime, ownerId, tenantId);
  expect(overview.summary.find(row => row.status === "pending")?.count).toBeGreaterThan(0);
  expect(overview.activeEvents.some(event => event.eventType === "export.generate_requested")).toBe(true);
  const exports = await db.query<{ status: string }>("select status from export_jobs where tenant_id=$1", [tenantId]);
  expect(exports.rows).toEqual([{ status: "queued" }]);
  expect(contexts).toEqual([{ tenantId, actorId: ownerId }]);
});

it("génère et rejoue les propositions d’autoamélioration avec les vrais loaders et leur audit", async () => {
  const first = await services.generateSelfImprovementProposals(ownerId, tenantId);
  expect(first.createdCount).toBeGreaterThan(0);
  const replay = await services.generateSelfImprovementProposals(ownerId, tenantId);
  expect(replay).toMatchObject({ createdCount: 0, unchangedCount: first.detectedCount });
  await expect(services.generateSelfImprovementProposals(outsiderId, tenantId)).rejects.toMatchObject({ code: "tenant_access_denied" });
  const audit = await db.query("select id from audit_logs where tenant_id=$1 and action='self_improvement.proposals_generated'", [tenantId]);
  expect(audit.rows.length).toBeGreaterThan(0);
  expect(fetchSpy).not.toHaveBeenCalled();
});

it("compare les observations consenties et rejoue la veille sans appel externe", async () => {
  const first = await services.generateCompetitorInsights(ownerId, tenantId);
  expect(first.createdIds).toHaveLength(1);
  expect(await services.generateCompetitorInsights(ownerId, tenantId)).toMatchObject({ createdIds: [] });
  await expect(services.generateCompetitorInsights(outsiderId, tenantId)).rejects.toMatchObject({ code: "tenant_access_denied" });
  expect(fetchSpy).not.toHaveBeenCalled();
});

it("calcule une estimation financière depuis les saisies et preuves réelles puis rejoue sans doublon", async () => {
  const first = await services.generateFinancialAssessment(ownerId, tenantId);
  expect(first.created).toBe(true);
  expect(await services.generateFinancialAssessment(ownerId, tenantId)).toEqual({ assessmentId: first.assessmentId, created: false });
  await expect(services.generateFinancialAssessment(outsiderId, tenantId)).rejects.toMatchObject({ code: "tenant_access_denied" });
  expect(fetchSpy).not.toHaveBeenCalled();
});

it("révise, délègue, approuve et finalise un plan explicitement mock sans requêtes superposées", async () => {
  const operationalBefore = (await db.query("select count(*)::int as count from tasks where tenant_id=$1", [tenantId])).rows;
  const original = await createConversationActionPlan(runtime, ownerId, { tenantId, threadId, sourceMessageId });
  const revised = await reviseConversationActionPlan(runtime, ownerId, tenantId, { planId: original.id, taskTitle: "Rappeler ce contact jeudi matin" });
  await delegateConversationActionPlan(runtime, ownerId, tenantId, { planId: revised.id, delegatedToUserId: managerId,
    expectedDelegationVersion: 0, idempotencyKey: "delegation:single-flight", confirmed: true });
  await decideConversationActionPlan(runtime, managerId, tenantId, { planId: revised.id, decision: "approved", reason: "Accord explicite pour le plan simulé de recette." });
  const executed = await executeConversationActionPlan(runtime, managerId, tenantId, revised.id);
  expect(executed.approvalStatus).toBe("executed");
  const replay = await executeConversationActionPlan(runtime, managerId, tenantId, revised.id);
  expect(replay.idempotentReplay).toBe(true);
  expect((await getConversationActionPlan(runtime, managerId, tenantId, revised.id)).approvalStatus).toBe("executed");
  expect((await db.query("select count(*)::int as count from tasks where tenant_id=$1", [tenantId])).rows).toEqual(operationalBefore);
  expect(statements.some(sql => sql.includes("conversation_action_plan_policy_receipts"))).toBe(true);
  expect(fetchSpy).not.toHaveBeenCalled();
});

it("refuse les destinations WhatsApp absentes après lectures sérialisées, sans déchiffrer de secret", async () => {
  const keyring = {
    activeKeyVersion: "unused", encrypt: vi.fn(() => { throw new Error("unexpected_encrypt"); }),
    decrypt: vi.fn(() => { throw new Error("unexpected_decrypt"); }),
  };
  const reference = { tenantId, endpointId: "endpoint_missing", channelIdentityId: "identity_missing" };
  expect(await createWhatsAppTwilioSecretResolvers(runtime, keyring).resolveDestination(reference)).toBeNull();
  expect(await createWhatsAppMetaSecretResolvers(runtime, keyring).resolveDestination(reference)).toBeNull();
  expect(keyring.decrypt).not.toHaveBeenCalled();
  expect(keyring.encrypt).not.toHaveBeenCalled();
  expect(statements.filter(sql => sql.includes("from channel_provider_secret_versions"))).toHaveLength(4);
  expect(contexts).toEqual([{ systemAccess: true }, { systemAccess: true }]);
});

it("évalue séquentiellement les trois preuves d’un candidat puis refuse un connecteur incomplet", async () => {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  let active: Promise<unknown> | undefined;
  const candidate = {
    store_entry_id: "store_fixture", proposal_id: "proposal_fixture", verification_status: "approved_for_sandbox",
    installation_status: "not_installed", proposal_status: "approved_for_sandbox", proposal_enabled: 0,
    connector_name: "Connecteur fictif", connector_version: "1", manifest: "{}", software_name: "Logiciel fictif", vendor: "Fictif",
    industries: "[]", api_product_id: "product_fixture", api_version: "1", api_last_verified_at: null, tenant_industry: "Services",
    contract_run_id: null, contract_status: null, contract_created_at: null,
  };
  const transaction = {
    __runtime: "postgres", __transaction: true,
    async query<T>(sql: string, params?: unknown[]) {
      if (active) { await active.catch(() => undefined); throw new Error("single_connection_query_overlap"); }
      calls.push({ sql, params });
      const pending = Promise.resolve().then(() => ({ rows: (sql.includes("select role from memberships") ? [{ role: "owner" }]
        : sql.includes("from private_connect_store_entries") ? [candidate] : []) as T[] }));
      active = pending;
      try { return await pending; } finally { if (active === pending) active = undefined; }
    },
  } as DbClient;
  await expect(prepareConnectorInstallationPlan(transaction, "owner_fixture", "tenant_fixture", { storeEntryId: "store_fixture" }))
    .rejects.toMatchObject({ code: "connector_evidence_incomplete" });
  expect(calls.map(call => call.params)).toEqual([
    ["owner_fixture", "tenant_fixture"], ["tenant_fixture", "store_fixture"], ["product_fixture"],
    ["tenant_fixture", "product_fixture"], ["product_fixture"],
  ]);
  expect(calls.every(call => !/^\s*(insert|update|delete)\b/i.test(call.sql))).toBe(true);
});
