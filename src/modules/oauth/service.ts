import { withTenantDbTransaction } from "@/db/tenant-context";
import type { DbClient } from "@/lib/db";
import { hashToken, id, nowIso, safeJson, secureToken } from "@/lib/security";
import { recordAuditLog } from "@/modules/audit";
import { resolveAppUrl } from "@/modules/email";
import {
  createPkceChallenge,
  decryptOAuthSecret,
  encryptOAuthSecret,
  getOAuthKeyVersion,
  verifyOAuthSecretHash,
} from "@/modules/oauth/crypto";
import { OAuthError } from "@/modules/oauth/errors";
import {
  authorizeOAuthState,
  claimOAuthCredentialRefresh,
  completeOAuthCredentialRefresh,
  consumeOAuthState,
  findOAuthState,
  insertOAuthCredential,
  insertOAuthState,
  revokeActiveOAuthCredentials,
} from "@/modules/oauth/repository";
import {
  mockOAuthAuthorizationRequestSchema,
  mockOAuthCallbackSchema,
  softwareConnectionReferenceSchema,
  startMockOAuthSchema,
  type MockOAuthAuthorizationRequestInput,
  type MockOAuthCallbackInput,
  type StartMockOAuthInput,
} from "@/modules/oauth/schemas";
import {
  findSoftwareConnection,
  insertSoftwareConnection,
  markSoftwareConnectionConnected,
} from "@/modules/software-connections/repository";
import { assertTenantAccess } from "@/modules/tenants";

const oauthAdminRoles = ["owner", "administrator"] as const;

export async function startMockOAuthConnection(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: StartMockOAuthInput = {},
  options: { appUrl?: string } = {},
) {
  const parsed = startMockOAuthSchema.parse(input);
  const appOrigin = resolveAppUrl(options.appUrl);
  const redirectUri = new URL("/api/oauth/mock/callback", appOrigin).toString();
  const state = secureToken(32);
  const verifier = secureToken(48);
  const codeChallenge = createPkceChallenge(verifier);
  const now = nowIso();
  const connectionId = id("software_connection");

  await withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [...oauthAdminRoles]);
    await insertSoftwareConnection(transaction, {
      id: connectionId,
      tenantId,
      softwareKey: "mock_business",
      softwareName: "Mock Business",
      providerKey: "mock_oauth",
      environment: "mock",
      status: "oauth_pending",
      accountLabel: parsed.accountLabel,
      scopes: parsed.scopes,
      createdBy: userId,
      now,
    });
    await insertOAuthState(transaction, {
      id: id("oauth_state"),
      tenantId,
      connectionId,
      stateHash: hashToken(state),
      codeChallenge,
      encryptedVerifier: encryptOAuthSecret(verifier),
      redirectUri,
      scopes: parsed.scopes,
      expiresAt: new Date(Date.now() + 10 * 60 * 1_000).toISOString(),
      createdBy: userId,
      now,
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "oauth.connection_started",
      targetType: "software_connection",
      targetId: connectionId,
      metadata: {
        providerKey: "mock_oauth",
        environment: "mock",
        scopes: parsed.scopes,
        pkceMethod: "S256",
        secretStoredInAudit: false,
      },
    });
  });

  const authorizationUrl = new URL("/oauth/mock/autoriser", appOrigin);
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("code_challenge", codeChallenge);
  authorizationUrl.searchParams.set("redirect_uri", redirectUri);
  return {
    connectionId,
    authorizationUrl: authorizationUrl.toString(),
    environment: "mock" as const,
    scopes: parsed.scopes,
  };
}

export async function inspectMockOAuthAuthorization(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: MockOAuthAuthorizationRequestInput,
  options: { appUrl?: string } = {},
) {
  await assertTenantAccess(db, userId, tenantId, [...oauthAdminRoles]);
  const parsed = mockOAuthAuthorizationRequestSchema.parse(input);
  const state = await validateAuthorizationRequest(
    db,
    userId,
    tenantId,
    parsed,
    options,
  );
  const connection = await findSoftwareConnection(
    db,
    tenantId,
    state.software_connection_id,
  );
  if (!connection) throw invalidState();
  return {
    connectionId: state.software_connection_id,
    softwareName: connection.software_name,
    accountLabel: connection.account_label,
    environment: connection.environment,
    scopes: safeJson<string[]>(state.scopes, []),
  };
}

export async function authorizeMockOAuthRequest(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: MockOAuthAuthorizationRequestInput,
  options: { appUrl?: string } = {},
) {
  const parsed = mockOAuthAuthorizationRequestSchema.parse(input);
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [...oauthAdminRoles]);
    const state = await validateAuthorizationRequest(
      transaction,
      userId,
      tenantId,
      parsed,
      options,
    );
    const code = secureToken(32);
    const authorizedAt = nowIso();
    const authorized = await authorizeOAuthState(transaction, {
      tenantId,
      stateId: state.id,
      authorizationCodeHash: hashToken(code),
      authorizedAt,
    });
    if (!authorized) {
      throw new OAuthError(
        "oauth_state_replayed",
        "Cette autorisation OAuth a déjà été accordée.",
      );
    }
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "oauth.authorization_granted",
      targetType: "software_connection",
      targetId: state.software_connection_id,
      metadata: {
        providerKey: "mock_oauth",
        environment: "mock",
        scopes: safeJson<string[]>(state.scopes, []),
        authorizationCodeStoredInAudit: false,
      },
    });
    const callbackUrl = new URL(state.redirect_uri);
    callbackUrl.searchParams.set("state", parsed.state);
    callbackUrl.searchParams.set("code", code);
    return { callbackUrl: callbackUrl.toString() };
  });
}

export async function completeMockOAuthConnection(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: MockOAuthCallbackInput,
  options: { appUrl?: string } = {},
) {
  const parsed = mockOAuthCallbackSchema.parse(input);
  const expectedRedirectUri = new URL(
    "/api/oauth/mock/callback",
    resolveAppUrl(options.appUrl),
  ).toString();
  if (parsed.redirectUri !== expectedRedirectUri) {
    throw new OAuthError(
      "oauth_redirect_mismatch",
      "L'adresse de retour OAuth n'est pas autorisée.",
    );
  }

  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [...oauthAdminRoles]);
    const state = await findOAuthState(transaction, {
      tenantId,
      stateHash: hashToken(parsed.state),
      userId,
    });
    if (!state) throw invalidState();
    if (state.consumed_at) {
      throw new OAuthError(
        "oauth_state_replayed",
        "Cette autorisation OAuth a déjà été utilisée.",
      );
    }
    if (new Date(state.expires_at).getTime() <= Date.now()) {
      throw new OAuthError(
        "oauth_state_expired",
        "Cette autorisation OAuth a expiré.",
      );
    }
    if (state.redirect_uri !== parsed.redirectUri) {
      throw new OAuthError(
        "oauth_redirect_mismatch",
        "L'adresse de retour OAuth ne correspond pas.",
      );
    }
    const verifier = decryptOAuthSecret(state.code_verifier_encrypted);
    if (createPkceChallenge(verifier) !== state.code_challenge) {
      throw new OAuthError(
        "oauth_code_invalid",
        "La preuve PKCE OAuth est invalide.",
      );
    }
    if (
      !state.authorization_code_hash ||
      !verifyOAuthSecretHash(parsed.code, state.authorization_code_hash)
    ) {
      throw new OAuthError(
        "oauth_code_invalid",
        "Le code OAuth est invalide.",
      );
    }
    const consumedAt = nowIso();
    const consumed = await consumeOAuthState(transaction, {
      tenantId,
      stateId: state.id,
      consumedAt,
    });
    if (!consumed) {
      throw new OAuthError(
        "oauth_state_replayed",
        "Cette autorisation OAuth a déjà été utilisée.",
      );
    }
    const scopes = safeJson<string[]>(state.scopes, []);
    await revokeActiveOAuthCredentials(transaction, {
      tenantId,
      connectionId: state.software_connection_id,
      now: consumedAt,
    });
    await insertOAuthCredential(transaction, {
      id: id("oauth_credential"),
      tenantId,
      connectionId: state.software_connection_id,
      providerKey: "mock_oauth",
      encryptedAccessToken: encryptOAuthSecret(`mock_access_${secureToken(32)}`),
      encryptedRefreshToken: encryptOAuthSecret(`mock_refresh_${secureToken(32)}`),
      scopes,
      expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
      keyVersion: getOAuthKeyVersion(),
      now: consumedAt,
    });
    await markSoftwareConnectionConnected(transaction, {
      tenantId,
      connectionId: state.software_connection_id,
      scopes,
      now: consumedAt,
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "oauth.connection_completed",
      targetType: "software_connection",
      targetId: state.software_connection_id,
      metadata: {
        providerKey: "mock_oauth",
        environment: "mock",
        scopes,
        tokenReturnedToBrowser: false,
        tokenStoredInAudit: false,
        keyVersion: getOAuthKeyVersion(),
      },
    });
    return {
      connectionId: state.software_connection_id,
      status: "connected" as const,
      environment: "mock" as const,
      scopes,
    };
  });
}

export async function refreshMockOAuthCredential(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: { connectionId: string },
) {
  const parsed = softwareConnectionReferenceSchema.parse(input);
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [...oauthAdminRoles]);
    const connection = await findSoftwareConnection(
      transaction,
      tenantId,
      parsed.connectionId,
    );
    if (!connection) {
      throw new OAuthError(
        "oauth_connection_not_found",
        "La connexion logicielle est introuvable.",
      );
    }
    if (connection.status === "disconnected" || connection.status === "revoked") {
      throw new OAuthError(
        "oauth_credential_revoked",
        "Les accès OAuth ont été révoqués.",
      );
    }
    const now = nowIso();
    const leaseId = id("oauth_refresh_lease");
    const credential = await claimOAuthCredentialRefresh(transaction, {
      tenantId,
      connectionId: connection.id,
      leaseId,
      leaseExpiresAt: new Date(Date.now() + 30_000).toISOString(),
      refreshedAt: now,
      minimumLastRefreshAt: new Date(Date.now() - 30_000).toISOString(),
    });
    if (!credential) {
      throw new OAuthError(
        "oauth_refresh_in_progress",
        "Un rafraîchissement OAuth est déjà en cours ou vient de terminer.",
      );
    }
    const refreshToken = decryptOAuthSecret(credential.refresh_token_encrypted);
    if (!refreshToken.startsWith("mock_refresh_")) {
      throw new OAuthError(
        "oauth_credential_revoked",
        "Le jeton de rafraîchissement est invalide.",
      );
    }
    const completed = await completeOAuthCredentialRefresh(transaction, {
      tenantId,
      credentialId: credential.id,
      leaseId,
      encryptedAccessToken: encryptOAuthSecret(`mock_access_${secureToken(32)}`),
      encryptedRefreshToken: encryptOAuthSecret(`mock_refresh_${secureToken(32)}`),
      expiresAt: new Date(Date.now() + 60 * 60 * 1_000).toISOString(),
      keyVersion: getOAuthKeyVersion(),
      now,
    });
    if (!completed) {
      throw new OAuthError(
        "oauth_refresh_in_progress",
        "Le verrou de rafraîchissement OAuth a expiré.",
      );
    }
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "oauth.credential_refreshed",
      targetType: "software_connection",
      targetId: connection.id,
      metadata: {
        providerKey: "mock_oauth",
        environment: "mock",
        tokenReturnedToBrowser: false,
        tokenStoredInAudit: false,
        keyVersion: getOAuthKeyVersion(),
      },
    });
    return { connectionId: connection.id, status: "connected" as const };
  });
}

function invalidState() {
  return new OAuthError(
    "oauth_state_invalid",
    "L'autorisation OAuth est invalide.",
  );
}

async function validateAuthorizationRequest(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: MockOAuthAuthorizationRequestInput,
  options: { appUrl?: string },
) {
  const expectedRedirectUri = new URL(
    "/api/oauth/mock/callback",
    resolveAppUrl(options.appUrl),
  ).toString();
  if (input.redirectUri !== expectedRedirectUri) {
    throw new OAuthError(
      "oauth_redirect_mismatch",
      "L'adresse de retour OAuth n'est pas autorisée.",
    );
  }
  const state = await findOAuthState(db, {
    tenantId,
    stateHash: hashToken(input.state),
    userId,
  });
  if (!state) throw invalidState();
  if (state.consumed_at || state.authorization_code_hash) {
    throw new OAuthError(
      "oauth_state_replayed",
      "Cette autorisation OAuth a déjà été utilisée.",
    );
  }
  if (new Date(state.expires_at).getTime() <= Date.now()) {
    throw new OAuthError(
      "oauth_state_expired",
      "Cette autorisation OAuth a expiré.",
    );
  }
  if (
    state.redirect_uri !== input.redirectUri ||
    state.code_challenge !== input.codeChallenge
  ) {
    throw new OAuthError(
      "oauth_code_invalid",
      "La preuve PKCE OAuth est invalide.",
    );
  }
  return state;
}
