import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { hashToken, safeJson } from "../src/lib/security";
import { createServices } from "../src/lib/services";
import { createMockAuthorizationCode } from "../src/modules/oauth";

const opened: Array<{ close: () => Promise<void> }> = [];
const appUrl = "https://app.example.test";

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("plateforme OAuth mock", () => {
  it("connecte un compte avec PKCE sans persister ni retourner de secret brut", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db, { appUrl });
    const owner = await services.registerUser({
      name: "OAuth Owner",
      email: "oauth-owner@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: "OAuth Atelier",
      category: "Garage automobile",
    });
    const started = await services.startMockOAuthConnection(owner.id, tenant.id, {
      accountLabel: "Compte atelier",
      scopes: ["contacts.read", "profile.read"],
    });
    const authorization = parseAuthorization(started.authorizationUrl);
    const stateRow = await db.query<{
      state_hash: string;
      code_challenge: string;
      code_verifier_encrypted: string;
      redirect_uri: string;
      consumed_at: string | null;
    }>(
      "select state_hash, code_challenge, code_verifier_encrypted, redirect_uri, consumed_at from oauth_states where software_connection_id = $1",
      [started.connectionId],
    );
    expect(stateRow.rows[0]).toMatchObject({
      state_hash: hashToken(authorization.state),
      code_challenge: authorization.codeChallenge,
      redirect_uri: authorization.redirectUri,
      consumed_at: null,
    });
    expect(stateRow.rows[0]?.state_hash).not.toBe(authorization.state);
    expect(stateRow.rows[0]?.code_verifier_encrypted).not.toContain(
      authorization.state,
    );

    const completed = await services.completeMockOAuthConnection(
      owner.id,
      tenant.id,
      callbackInput(authorization),
    );
    expect(completed).toEqual({
      connectionId: started.connectionId,
      status: "connected",
      environment: "mock",
      scopes: ["contacts.read", "profile.read"],
    });
    expect(completed).not.toHaveProperty("accessToken");
    expect(completed).not.toHaveProperty("refreshToken");

    const credential = await db.query<{
      access_token_encrypted: string;
      refresh_token_encrypted: string;
      key_version: string;
      token_version: number;
      revoked_at: string | null;
    }>(
      "select access_token_encrypted, refresh_token_encrypted, key_version, token_version, revoked_at from oauth_credentials where tenant_id = $1 and software_connection_id = $2",
      [tenant.id, started.connectionId],
    );
    expect(credential.rows[0]).toMatchObject({
      token_version: 1,
      revoked_at: null,
    });
    expect(credential.rows[0]?.key_version).toBeTruthy();
    expect(credential.rows[0]?.access_token_encrypted).not.toContain("mock_access_");
    expect(credential.rows[0]?.refresh_token_encrypted).not.toContain(
      "mock_refresh_",
    );
    expect(JSON.parse(credential.rows[0]?.access_token_encrypted ?? "{}")).toMatchObject({
      alg: "aes-256-gcm",
    });

    const workspace = await services.getSoftwareConnectionWorkspace(
      owner.id,
      tenant.id,
    );
    expect(workspace.connections).toEqual([
      expect.objectContaining({
        id: started.connectionId,
        status: "connected",
        environment: "mock",
        accountLabel: "Compte atelier",
        scopes: ["contacts.read", "profile.read"],
      }),
    ]);
    const audit = await db.query<{ safe_metadata: string }>(
      `select safe_metadata from audit_logs
       where tenant_id = $1 and action = 'oauth.connection_completed'
       order by created_at desc limit 1`,
      [tenant.id],
    );
    const metadata = safeJson<Record<string, unknown>>(
      audit.rows[0]?.safe_metadata,
      {},
    );
    expect(metadata).toMatchObject({
      tokenReturnedToBrowser: false,
      tokenStoredInAudit: false,
    });
    expect(JSON.stringify(metadata)).not.toContain(authorization.state);
  });

  it("rejette état invalide, rejeu, redirection différente et état expiré", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db, { appUrl });
    const owner = await services.registerUser({
      name: "OAuth Security",
      email: "oauth-security@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: "OAuth Security",
      category: "Conseil",
    });
    const first = await services.startMockOAuthConnection(owner.id, tenant.id);
    const authorization = parseAuthorization(first.authorizationUrl);

    await expect(
      services.completeMockOAuthConnection(owner.id, tenant.id, {
        ...callbackInput(authorization),
        state: "A".repeat(48),
      }),
    ).rejects.toMatchObject({ code: "oauth_state_invalid" });
    await expect(
      services.completeMockOAuthConnection(owner.id, tenant.id, {
        ...callbackInput(authorization),
        redirectUri: "https://evil.example.test/callback",
      }),
    ).rejects.toMatchObject({ code: "oauth_redirect_mismatch" });

    await services.completeMockOAuthConnection(
      owner.id,
      tenant.id,
      callbackInput(authorization),
    );
    await expect(
      services.completeMockOAuthConnection(
        owner.id,
        tenant.id,
        callbackInput(authorization),
      ),
    ).rejects.toMatchObject({ code: "oauth_state_replayed" });

    const expired = await services.startMockOAuthConnection(owner.id, tenant.id);
    const expiredAuthorization = parseAuthorization(expired.authorizationUrl);
    await db.query(
      "update oauth_states set expires_at = $1 where software_connection_id = $2",
      [new Date(Date.now() - 1_000).toISOString(), expired.connectionId],
    );
    await expect(
      services.completeMockOAuthConnection(
        owner.id,
        tenant.id,
        callbackInput(expiredAuthorization),
      ),
    ).rejects.toMatchObject({ code: "oauth_state_expired" });
  });

  it("isole les états et credentials entre tenants, verrouille le refresh et révoque", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db, { appUrl });
    const ownerA = await services.registerUser({
      name: "OAuth A",
      email: "oauth-a@example.com",
      password: "Password!1",
    });
    const ownerB = await services.registerUser({
      name: "OAuth B",
      email: "oauth-b@example.com",
      password: "Password!1",
    });
    const tenantA = await services.createTenant(ownerA.id, {
      name: "OAuth Tenant A",
      category: "Commerce",
    });
    const tenantB = await services.createTenant(ownerB.id, {
      name: "OAuth Tenant B",
      category: "Services",
    });
    const started = await services.startMockOAuthConnection(ownerA.id, tenantA.id);
    const authorization = parseAuthorization(started.authorizationUrl);
    await expect(
      services.completeMockOAuthConnection(
        ownerB.id,
        tenantB.id,
        callbackInput(authorization),
      ),
    ).rejects.toMatchObject({ code: "oauth_state_invalid" });
    await services.completeMockOAuthConnection(
      ownerA.id,
      tenantA.id,
      callbackInput(authorization),
    );
    await expect(
      services.getSoftwareConnectionWorkspace(ownerB.id, tenantA.id),
    ).rejects.toThrow("Acces refuse");

    await expect(
      services.refreshMockOAuthCredential(ownerA.id, tenantA.id, started.connectionId),
    ).resolves.toMatchObject({ status: "connected" });
    await expect(
      services.refreshMockOAuthCredential(ownerA.id, tenantA.id, started.connectionId),
    ).rejects.toMatchObject({ code: "oauth_refresh_in_progress" });
    expect(
      (
        await db.query<{ token_version: number }>(
          "select token_version from oauth_credentials where tenant_id = $1 and software_connection_id = $2",
          [tenantA.id, started.connectionId],
        )
      ).rows[0]?.token_version,
    ).toBe(2);

    await expect(
      services.disconnectSoftwareConnection(ownerA.id, tenantA.id, started.connectionId),
    ).resolves.toEqual({
      connectionId: started.connectionId,
      status: "disconnected",
      credentialsRevoked: true,
    });
    expect(
      (
        await db.query<{ revoked_at: string | null }>(
          "select revoked_at from oauth_credentials where tenant_id = $1 and software_connection_id = $2",
          [tenantA.id, started.connectionId],
        )
      ).rows[0]?.revoked_at,
    ).toBeTruthy();
    await expect(
      services.refreshMockOAuthCredential(ownerA.id, tenantA.id, started.connectionId),
    ).rejects.toMatchObject({ code: "oauth_credential_revoked" });
  });
});

function parseAuthorization(value: string) {
  const url = new URL(value);
  const state = url.searchParams.get("state");
  const codeChallenge = url.searchParams.get("code_challenge");
  const redirectUri = url.searchParams.get("redirect_uri");
  if (!state || !codeChallenge || !redirectUri) {
    throw new Error("Autorisation OAuth mock incomplète.");
  }
  return { state, codeChallenge, redirectUri };
}

function callbackInput(input: ReturnType<typeof parseAuthorization>) {
  return {
    state: input.state,
    redirectUri: input.redirectUri,
    code: createMockAuthorizationCode(input),
  };
}
