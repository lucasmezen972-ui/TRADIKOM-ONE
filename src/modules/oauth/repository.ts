import type { DbClient } from "@/lib/db";
import { toJson } from "@/lib/security";

export type OAuthStateRow = {
  id: string;
  tenant_id: string;
  software_connection_id: string;
  state_hash: string;
  code_challenge: string;
  code_verifier_encrypted: string;
  redirect_uri: string;
  scopes: string;
  expires_at: string;
  authorization_code_hash: string | null;
  authorized_at: string | null;
  consumed_at: string | null;
  created_by: string;
  created_at: string;
};

export type OAuthCredentialRow = {
  id: string;
  tenant_id: string;
  software_connection_id: string;
  provider_key: string;
  access_token_encrypted: string;
  refresh_token_encrypted: string;
  scopes: string;
  expires_at: string;
  revoked_at: string | null;
  key_version: string;
  token_version: number | string;
  refresh_lease_id: string | null;
  refresh_lease_expires_at: string | null;
  last_refreshed_at: string | null;
  last_used_at: string | null;
  failed_authentication_count: number | string;
  created_at: string;
  updated_at: string;
};

export type DueOAuthCredentialRow = OAuthCredentialRow & {
  actor_id: string;
};

export async function insertOAuthState(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    connectionId: string;
    stateHash: string;
    codeChallenge: string;
    encryptedVerifier: string;
    redirectUri: string;
    scopes: string[];
    expiresAt: string;
    createdBy: string;
    now: string;
  },
) {
  await db.query(
    `insert into oauth_states (
       id, tenant_id, software_connection_id, state_hash, code_challenge,
       code_verifier_encrypted, redirect_uri, scopes, expires_at, consumed_at,
       created_by, created_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, null, $10, $11)`,
    [
      input.id,
      input.tenantId,
      input.connectionId,
      input.stateHash,
      input.codeChallenge,
      input.encryptedVerifier,
      input.redirectUri,
      toJson(input.scopes),
      input.expiresAt,
      input.createdBy,
      input.now,
    ],
  );
}

export async function findOAuthState(
  db: DbClient,
  input: { tenantId: string; stateHash: string; userId: string },
) {
  const result = await db.query<OAuthStateRow>(
    `select * from oauth_states
     where tenant_id = $1 and state_hash = $2 and created_by = $3`,
    [input.tenantId, input.stateHash, input.userId],
  );
  return result.rows[0] ?? null;
}

export async function consumeOAuthState(
  db: DbClient,
  input: { tenantId: string; stateId: string; consumedAt: string },
) {
  const result = await db.query<{ id: string }>(
    `update oauth_states set consumed_at = $1
     where tenant_id = $2 and id = $3 and consumed_at is null
     returning id`,
    [input.consumedAt, input.tenantId, input.stateId],
  );
  return result.rows[0] ?? null;
}

export async function consumePendingOAuthStates(
  db: DbClient,
  input: { tenantId: string; connectionId: string; consumedAt: string },
) {
  await db.query(
    `update oauth_states set consumed_at = $1
     where tenant_id = $2 and software_connection_id = $3
       and consumed_at is null`,
    [input.consumedAt, input.tenantId, input.connectionId],
  );
}

export async function authorizeOAuthState(
  db: DbClient,
  input: {
    tenantId: string;
    stateId: string;
    authorizationCodeHash: string;
    authorizedAt: string;
  },
) {
  const result = await db.query<{ id: string }>(
    `update oauth_states
     set authorization_code_hash = $1, authorized_at = $2
     where tenant_id = $3 and id = $4 and consumed_at is null
       and authorization_code_hash is null
     returning id`,
    [
      input.authorizationCodeHash,
      input.authorizedAt,
      input.tenantId,
      input.stateId,
    ],
  );
  return result.rows[0] ?? null;
}

export async function insertOAuthCredential(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    connectionId: string;
    providerKey: string;
    encryptedAccessToken: string;
    encryptedRefreshToken: string;
    scopes: string[];
    expiresAt: string;
    keyVersion: string;
    now: string;
  },
) {
  await db.query(
    `insert into oauth_credentials (
       id, tenant_id, software_connection_id, provider_key,
       access_token_encrypted, refresh_token_encrypted, scopes, expires_at,
       revoked_at, key_version, token_version, refresh_lease_id,
       refresh_lease_expires_at, last_refreshed_at, last_used_at,
       failed_authentication_count, created_at, updated_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, null, $9, 1, null,
               null, null, null, 0, $10, $10)`,
    [
      input.id,
      input.tenantId,
      input.connectionId,
      input.providerKey,
      input.encryptedAccessToken,
      input.encryptedRefreshToken,
      toJson(input.scopes),
      input.expiresAt,
      input.keyVersion,
      input.now,
    ],
  );
}

export async function revokeActiveOAuthCredentials(
  db: DbClient,
  input: { tenantId: string; connectionId: string; now: string },
) {
  await db.query(
    `update oauth_credentials set revoked_at = $1, updated_at = $1,
       refresh_lease_id = null, refresh_lease_expires_at = null
     where tenant_id = $2 and software_connection_id = $3 and revoked_at is null`,
    [input.now, input.tenantId, input.connectionId],
  );
}

export async function findActiveOAuthCredential(
  db: DbClient,
  tenantId: string,
  connectionId: string,
) {
  const result = await db.query<OAuthCredentialRow>(
    `select * from oauth_credentials
      where tenant_id = $1 and software_connection_id = $2
        and revoked_at is null
      order by created_at desc, id desc limit 1`,
    [tenantId, connectionId],
  );
  return result.rows[0] ?? null;
}

export async function listDueOAuthCredentials(
  db: DbClient,
  input: { expiresBefore: string; now: string; limit: number },
) {
  const result = await db.query<DueOAuthCredentialRow>(
    `select credential.*, connection.created_by as actor_id
       from oauth_credentials credential
       join software_connections connection
         on connection.tenant_id = credential.tenant_id
        and connection.id = credential.software_connection_id
      where credential.revoked_at is null
        and credential.provider_key = 'mock_oauth'
        and credential.expires_at <= $1
        and (credential.refresh_lease_expires_at is null
          or credential.refresh_lease_expires_at < $2)
        and connection.status not in ('disconnected', 'revoked')
      order by credential.expires_at, credential.id
      limit $3`,
    [input.expiresBefore, input.now, input.limit],
  );
  return result.rows;
}

export async function claimOAuthCredentialRefresh(
  db: DbClient,
  input: {
    tenantId: string;
    connectionId: string;
    leaseId: string;
    leaseExpiresAt: string;
    refreshedAt: string;
    minimumLastRefreshAt: string;
  },
) {
  const result = await db.query<OAuthCredentialRow>(
    `update oauth_credentials
     set refresh_lease_id = $1, refresh_lease_expires_at = $2,
         last_refreshed_at = $3, updated_at = $3
     where tenant_id = $4 and software_connection_id = $5
       and revoked_at is null
       and (refresh_lease_expires_at is null or refresh_lease_expires_at < $3)
       and (last_refreshed_at is null or last_refreshed_at < $6)
     returning *`,
    [
      input.leaseId,
      input.leaseExpiresAt,
      input.refreshedAt,
      input.tenantId,
      input.connectionId,
      input.minimumLastRefreshAt,
    ],
  );
  return result.rows[0] ?? null;
}

export async function completeOAuthCredentialRefresh(
  db: DbClient,
  input: {
    tenantId: string;
    credentialId: string;
    leaseId: string;
    encryptedAccessToken: string;
    encryptedRefreshToken: string;
    expiresAt: string;
    keyVersion: string;
    now: string;
  },
) {
  const result = await db.query<{ id: string }>(
    `update oauth_credentials
     set access_token_encrypted = $1, refresh_token_encrypted = $2,
         expires_at = $3, key_version = $4, token_version = token_version + 1,
         refresh_lease_id = null, refresh_lease_expires_at = null, updated_at = $5
     where tenant_id = $6 and id = $7 and refresh_lease_id = $8
       and revoked_at is null
     returning id`,
    [
      input.encryptedAccessToken,
      input.encryptedRefreshToken,
      input.expiresAt,
      input.keyVersion,
      input.now,
      input.tenantId,
      input.credentialId,
      input.leaseId,
    ],
  );
  return result.rows[0] ?? null;
}
