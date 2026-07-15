import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { safeJson } from "../src/lib/security";
import { createServices } from "../src/lib/services";
import { evaluateConnectorPolicy } from "../src/modules/connector-execution";

const opened: Array<{ close: () => Promise<void> }> = [];
const appUrl = "https://connector-execution.example.test";

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("exécution contrôlée des connecteurs", () => {
  it("installe désactivé, exige l'activation, exécute en lecture seule et rejoue idempotemment", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db, { appUrl });
    const owner = await services.registerUser({
      name: "Connector Owner",
      email: "connector-owner@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: "Connector Atelier",
      category: "Garage automobile",
    });
    const connectionId = await connectMockSoftware(
      services,
      owner.id,
      tenant.id,
    );
    const installation = await services.prepareMockConnectorInstallation(
      owner.id,
      tenant.id,
      connectionId,
    );
    expect(installation).toMatchObject({
      connectionId,
      status: "installed_disabled",
      environment: "mock",
      approvedOperations: ["contacts.list", "profile.read"],
    });
    await expect(
      services.prepareMockConnectorInstallation(
        owner.id,
        tenant.id,
        connectionId,
      ),
    ).resolves.toMatchObject({ id: installation.id });
    const installationCount = await db.query<{ count: number | string }>(
      "select count(*) as count from connector_installations where tenant_id = $1",
      [tenant.id],
    );
    expect(Number(installationCount.rows[0]?.count)).toBe(1);

    const denied = await services.executeMockConnectorOperation(
      owner.id,
      tenant.id,
      executionInput(installation.id, "disabled-attempt"),
    );
    expect(denied).toMatchObject({
      status: "denied",
      safeErrorClassification: "installation_disabled",
    });

    await services.enableMockConnectorReadOnly(
      owner.id,
      tenant.id,
      installation.id,
    );
    const input = executionInput(installation.id, "first-approved-sync");
    const first = await services.executeMockConnectorOperation(
      owner.id,
      tenant.id,
      input,
    );
    const replay = await services.executeMockConnectorOperation(
      owner.id,
      tenant.id,
      input,
    );
    expect(first).toMatchObject({
      status: "succeeded",
      operation: "contacts.list",
      capability: "read",
      environment: "mock",
      safeResultSummary: "3 clients, 2 rendez-vous et 1 devis simulés lus.",
      idempotentReplay: false,
    });
    expect(replay).toMatchObject({
      id: first.id,
      status: "succeeded",
      idempotentReplay: true,
    });
    expect(JSON.stringify(first)).not.toContain("mock_access_");
    expect(JSON.stringify(first)).not.toContain("mock_refresh_");

    const executions = await db.query<{ id: string }>(
      "select id from connector_executions where tenant_id = $1 and connector_installation_id = $2",
      [tenant.id, installation.id],
    );
    expect(executions.rows).toHaveLength(2);
    const workspace = await services.getConnectorExecutionWorkspace(
      owner.id,
      tenant.id,
    );
    expect(workspace.installations[0]).toMatchObject({
      id: installation.id,
      status: "read_only_enabled",
      health: expect.objectContaining({
        state: "healthy",
        authenticationState: "valid",
        recommendedAction: "Aucune action requise",
      }),
      latestExecution: expect.objectContaining({ status: "succeeded" }),
    });
  });

  it("refuse les opérations non approuvées, l'écriture, le mauvais environnement et le quota épuisé", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db, { appUrl });
    const owner = await services.registerUser({
      name: "Policy Owner",
      email: "policy-owner@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: "Policy Atelier",
      category: "Commerce",
    });
    const connectionId = await connectMockSoftware(
      services,
      owner.id,
      tenant.id,
    );
    const installation = await services.prepareMockConnectorInstallation(
      owner.id,
      tenant.id,
      connectionId,
    );
    await services.enableMockConnectorReadOnly(
      owner.id,
      tenant.id,
      installation.id,
    );

    await expect(
      services.executeMockConnectorOperation(owner.id, tenant.id, {
        ...executionInput(installation.id, "write-attempt"),
        operation: "contacts.create",
        capability: "write",
      }),
    ).resolves.toMatchObject({
      status: "denied",
      safeErrorClassification: "capability_not_allowed",
    });
    await expect(
      services.executeMockConnectorOperation(owner.id, tenant.id, {
        ...executionInput(installation.id, "operation-attempt"),
        operation: "contacts.delete",
      }),
    ).resolves.toMatchObject({
      status: "denied",
      safeErrorClassification: "operation_not_approved",
    });
    await expect(
      services.executeMockConnectorOperation(owner.id, tenant.id, {
        ...executionInput(installation.id, "environment-attempt"),
        environment: "production",
      }),
    ).resolves.toMatchObject({
      status: "denied",
      safeErrorClassification: "environment_not_allowed",
    });

    await db.query(
      `update connector_installations
       set rate_limit_limit = 1, rate_limit_remaining = 1, rate_limit_reset_at = $1
       where tenant_id = $2 and id = $3`,
      [new Date(Date.now() + 60_000).toISOString(), tenant.id, installation.id],
    );
    await expect(
      services.executeMockConnectorOperation(
        owner.id,
        tenant.id,
        executionInput(installation.id, "quota-first"),
      ),
    ).resolves.toMatchObject({ status: "succeeded", rateLimitRemaining: 0 });
    await expect(
      services.executeMockConnectorOperation(
        owner.id,
        tenant.id,
        executionInput(installation.id, "quota-second"),
      ),
    ).resolves.toMatchObject({
      status: "denied",
      safeErrorClassification: "rate_limited",
    });

    const policyBase = {
      requestedTenantId: tenant.id,
      tenantId: tenant.id,
      status: "read_only_enabled" as const,
      environment: "mock" as const,
      requestedEnvironment: "mock" as const,
      operation: "contacts.list",
      capability: "read" as const,
      approvedOperations: ["contacts.list"],
      requiredScopes: ["contacts.read"],
      credentialScopes: ["contacts.read"],
      credentialExpiresAt: new Date(Date.now() + 60_000).toISOString(),
      credentialRevokedAt: null,
      connectorVersion: "1.0.0",
      apiVersion: "mock-v1",
      securitySuspended: false,
      breakingChangeBlocked: false,
      now: new Date(),
    };
    expect(
      evaluateConnectorPolicy({
        ...policyBase,
        tenantId: "another-tenant",
      }),
    ).toMatchObject({ allowed: false, code: "tenant_mismatch" });
    expect(
      evaluateConnectorPolicy({ ...policyBase, securitySuspended: true }),
    ).toMatchObject({ allowed: false, code: "security_suspended" });
    expect(
      evaluateConnectorPolicy({ ...policyBase, breakingChangeBlocked: true }),
    ).toMatchObject({ allowed: false, code: "breaking_change_blocked" });
    expect(
      evaluateConnectorPolicy({ ...policyBase, credentialScopes: [] }),
    ).toMatchObject({ allowed: false, code: "scope_missing" });
    expect(
      evaluateConnectorPolicy({
        ...policyBase,
        credentialExpiresAt: new Date(Date.now() - 1_000).toISOString(),
      }),
    ).toMatchObject({ allowed: false, code: "authentication_expired" });
    expect(
      evaluateConnectorPolicy({ ...policyBase, connectorVersion: "2.0.0" }),
    ).toMatchObject({
      allowed: false,
      code: "connector_version_unsupported",
    });
  });

  it("isole les installations et rend la déconnexion irréversible sans reconnexion", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db, { appUrl });
    const ownerA = await services.registerUser({
      name: "Connector A",
      email: "connector-a@example.com",
      password: "Password!1",
    });
    const ownerB = await services.registerUser({
      name: "Connector B",
      email: "connector-b@example.com",
      password: "Password!1",
    });
    const tenantA = await services.createTenant(ownerA.id, {
      name: "Connector Tenant A",
      category: "Commerce",
    });
    const tenantB = await services.createTenant(ownerB.id, {
      name: "Connector Tenant B",
      category: "Services",
    });
    const connectionId = await connectMockSoftware(
      services,
      ownerA.id,
      tenantA.id,
    );
    const installation = await services.prepareMockConnectorInstallation(
      ownerA.id,
      tenantA.id,
      connectionId,
    );
    await services.enableMockConnectorReadOnly(
      ownerA.id,
      tenantA.id,
      installation.id,
    );

    await expect(
      services.getConnectorExecutionWorkspace(ownerB.id, tenantA.id),
    ).rejects.toThrow("Acces refuse");
    await expect(
      services.enableMockConnectorReadOnly(ownerB.id, tenantB.id, installation.id),
    ).rejects.toMatchObject({ code: "installation_not_found" });

    await services.disconnectSoftwareConnection(
      ownerA.id,
      tenantA.id,
      connectionId,
    );
    const workspace = await services.getConnectorExecutionWorkspace(
      ownerA.id,
      tenantA.id,
    );
    expect(workspace.installations[0]).toMatchObject({
      status: "disconnected",
      health: expect.objectContaining({
        state: "disconnected",
        authenticationState: "revoked",
      }),
    });
    await expect(
      services.executeMockConnectorOperation(
        ownerA.id,
        tenantA.id,
        executionInput(installation.id, "after-disconnect"),
      ),
    ).resolves.toMatchObject({
      status: "denied",
      safeErrorClassification: "installation_disabled",
    });

    const audit = await db.query<{ safe_metadata: string }>(
      `select safe_metadata from audit_logs
       where tenant_id = $1 and action like 'connector.%'
       order by created_at desc`,
      [tenantA.id],
    );
    expect(audit.rows.length).toBeGreaterThan(0);
    expect(
      audit.rows.flatMap((row) => Object.keys(safeJson(row.safe_metadata, {}))),
    ).not.toContain("accessToken");
  });
});

function executionInput(installationId: string, key: string) {
  return {
    installationId,
    operation: "contacts.list",
    capability: "read" as const,
    environment: "mock" as const,
    idempotencyKey: key.padEnd(8, "-"),
    correlationId: randomUUID(),
  };
}

async function connectMockSoftware(
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
    throw new Error("Autorisation OAuth mock incomplète.");
  }
  const granted = await services.authorizeMockOAuthRequest(userId, tenantId, {
    state,
    codeChallenge,
    redirectUri,
  });
  const callback = new URL(granted.callbackUrl);
  const code = callback.searchParams.get("code");
  if (!code) throw new Error("Code OAuth mock manquant.");
  await services.completeMockOAuthConnection(userId, tenantId, {
    state,
    code,
    redirectUri,
  });
  return started.connectionId;
}
