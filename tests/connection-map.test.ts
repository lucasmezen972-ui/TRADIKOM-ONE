import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { defaultGarageOnboarding } from "../src/lib/generation";
import { correlationId } from "../src/lib/security";
import { createServices } from "../src/lib/services";
import { processDomainVerificationJob } from "../src/modules/domain-connections";

const opened: Array<{ close: () => Promise<void> }> = [];
const appUrl = "https://map.example.test";

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("carte bornée des connexions", () => {
  it("compose les services existants sans inventer de gain financier ou temporel", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db, { appUrl });
    const owner = await services.registerUser({
      name: "Carte Owner",
      email: "connection-map@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: "Carte Atelier",
      category: "Garage automobile",
    });
    await services.saveOnboarding(
      owner.id,
      tenant.id,
      defaultGarageOnboarding(),
    );
    await services.publishWebsite(owner.id, tenant.id);
    const domain = await services.analyzeDomainConnection(owner.id, tenant.id, {
      domain: "carte.example.test",
      providerKey: "mock_dns",
    });
    const plan = await services.prepareDnsChangePlan(owner.id, tenant.id, {
      connectionId: domain.connectionId,
    });
    await services.approveDnsChangePlan(owner.id, tenant.id, plan.planId);
    await services.confirmDnsChangePlan(owner.id, tenant.id, plan.planId);
    await services.simulateDnsChangePlan(owner.id, tenant.id, plan.planId);
    const binding = await services.requestWebsiteDomainBinding(
      owner.id,
      tenant.id,
      domain.connectionId,
    );
    const softwareConnectionId = await connectMockOAuth(
      services,
      owner.id,
      tenant.id,
    );
    const installation = await services.prepareMockConnectorInstallation(
      owner.id,
      tenant.id,
      softwareConnectionId,
    );
    await services.enableMockConnectorReadOnly(
      owner.id,
      tenant.id,
      installation.id,
    );
    await services.executeMockConnectorOperation(owner.id, tenant.id, {
      installationId: installation.id,
      operation: "contacts.list",
      capability: "read",
      environment: "mock",
      idempotencyKey: "connection-map-sync",
      correlationId: correlationId(),
    });
    await processDomainVerificationJob(
      db,
      owner.id,
      tenant.id,
      binding.jobId,
    );

    const map = await services.getConnectionMap(owner.id, tenant.id);
    expect(map.nodes.length).toBeLessThanOrEqual(map.limits.nodeLimit);
    expect(map.nodes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "platform", status: "healthy" }),
        expect.objectContaining({ id: "website", status: "healthy" }),
        expect.objectContaining({
          id: "email-provider",
          kind: "email",
          status: "active",
        }),
        expect.objectContaining({
          id: "approvals",
          kind: "approval",
          status: "healthy",
        }),
        expect.objectContaining({
          kind: "domain",
          label: "carte.example.test",
          status: "healthy",
          environment: "mock",
        }),
        expect.objectContaining({
          kind: "software",
          label: "Mock Business",
          status: "active",
        }),
        expect.objectContaining({
          kind: "connector",
          status: "healthy",
          environment: "mock",
        }),
      ]),
    );
    expect(map.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          label: "Liaison vérifiée",
          direction: "inbound",
        }),
        expect.objectContaining({
          label: "Synchronisation contrôlée",
          direction: "inbound",
        }),
      ]),
    );
    expect(map.valueSummaries[0]).toMatchObject({
      title: "Mock Business",
      setupEffort: "faible",
      expectedTimeSaving: null,
      confidence: "fixture_locale",
    });
    expect(map.valueSummaries[0]?.unavailableInputs).toContain(
      "Durée moyenne mesurée par tâche",
    );
    expect(map.limits).toMatchObject({
      financialGainAvailable: false,
      timeSavingMeasured: false,
    });
    expect(JSON.stringify(map)).not.toMatch(
      /mock_access_|mock_refresh_|access_token|refresh_token|password_hash/i,
    );

    const isolatedOwner = await services.registerUser({
      name: "Carte B",
      email: "connection-map-b@example.com",
      password: "Password!1",
    });
    const isolatedTenant = await services.createTenant(isolatedOwner.id, {
      name: "Carte B",
      category: "Services",
    });
    const isolatedMap = await services.getConnectionMap(
      isolatedOwner.id,
      isolatedTenant.id,
    );
    expect(
      isolatedMap.nodes.some((node) => node.label === "carte.example.test"),
    ).toBe(false);
    await expect(
      services.getConnectionMap(isolatedOwner.id, tenant.id),
    ).rejects.toThrow("Acces refuse");
  });
});

async function connectMockOAuth(
  services: ReturnType<typeof createServices>,
  userId: string,
  tenantId: string,
) {
  const started = await services.startMockOAuthConnection(userId, tenantId);
  const authorization = new URL(started.authorizationUrl);
  const state = authorization.searchParams.get("state");
  const codeChallenge = authorization.searchParams.get("code_challenge");
  const redirectUri = authorization.searchParams.get("redirect_uri");
  if (!state || !codeChallenge || !redirectUri) {
    throw new Error("Autorisation OAuth incomplète.");
  }
  const granted = await services.authorizeMockOAuthRequest(userId, tenantId, {
    state,
    codeChallenge,
    redirectUri,
  });
  const callback = new URL(granted.callbackUrl);
  const code = callback.searchParams.get("code");
  if (!code) throw new Error("Code OAuth manquant.");
  await services.completeMockOAuthConnection(userId, tenantId, {
    state,
    code,
    redirectUri,
  });
  return started.connectionId;
}
