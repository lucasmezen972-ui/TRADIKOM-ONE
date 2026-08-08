import type { DbClient } from "@/lib/db";

export type ChannelProviderSecretScope = "endpoint" | "identity";

export type ChannelProviderSecretVersionRow = {
  id: string;
  tenant_id: string;
  provider: "whatsapp_twilio";
  endpoint_id: string;
  channel_identity_id: string | null;
  secret_scope: ChannelProviderSecretScope;
  encrypted_payload: string;
  key_version: string;
  secret_version: number;
  rotation_key_hash: string;
  revoked_at: string | null;
  revoked_by: string | null;
  created_by: string;
  created_at: string;
};

export async function lockActiveWhatsAppEndpoint(
  db: DbClient,
  tenantId: string,
  endpointId: string,
) {
  const result = await db.query<{ id: string; external_account_id: string }>(
    `select id, external_account_id from channel_provider_endpoints
     where tenant_id = $1 and id = $2
       and provider = 'whatsapp_twilio' and status = 'active'
     for update`,
    [tenantId, endpointId],
  );
  return result.rows[0] ?? null;
}

export async function lockWhatsAppEndpoint(
  db: DbClient,
  tenantId: string,
  endpointId: string,
) {
  const result = await db.query<{ id: string; status: "active" | "disabled" }>(
    `select id, status from channel_provider_endpoints
     where tenant_id = $1 and id = $2 and provider = 'whatsapp_twilio'
     for update`,
    [tenantId, endpointId],
  );
  return result.rows[0] ?? null;
}

export async function findActiveWhatsAppIdentity(
  db: DbClient,
  tenantId: string,
  channelIdentityId: string,
) {
  const result = await db.query<{ id: string }>(
    `select id from conversation_channel_identities
     where tenant_id = $1 and id = $2
       and adapter_key = 'whatsapp-twilio' and state = 'active'`,
    [tenantId, channelIdentityId],
  );
  return result.rows[0] ?? null;
}

export async function findWhatsAppIdentity(
  db: DbClient,
  tenantId: string,
  channelIdentityId: string,
) {
  const result = await db.query<{ id: string; state: string }>(
    `select id, state from conversation_channel_identities
     where tenant_id = $1 and id = $2
       and adapter_key = 'whatsapp-twilio'`,
    [tenantId, channelIdentityId],
  );
  return result.rows[0] ?? null;
}

export async function findSecretVersionByRotationKey(
  db: DbClient,
  tenantId: string,
  rotationKeyHash: string,
) {
  const result = await db.query<ChannelProviderSecretVersionRow>(
    `select * from channel_provider_secret_versions
     where tenant_id = $1 and provider = 'whatsapp_twilio'
       and rotation_key_hash = $2`,
    [tenantId, rotationKeyHash],
  );
  return result.rows[0] ?? null;
}

export async function nextSecretVersion(
  db: DbClient,
  input: {
    tenantId: string;
    endpointId: string;
    channelIdentityId: string | null;
    scope: ChannelProviderSecretScope;
  },
) {
  const result = await db.query<{ next_version: number }>(
    `select coalesce(max(secret_version), 0) + 1 as next_version
     from channel_provider_secret_versions
     where tenant_id = $1 and provider = 'whatsapp_twilio'
       and endpoint_id = $2 and secret_scope = $3
       and channel_identity_id is not distinct from $4`,
    [input.tenantId, input.endpointId, input.scope, input.channelIdentityId],
  );
  return Number(result.rows[0]?.next_version ?? 1);
}

export async function revokeActiveSecretVersions(
  db: DbClient,
  input: {
    tenantId: string;
    endpointId: string;
    channelIdentityId: string | null;
    scope: ChannelProviderSecretScope;
    actorId: string;
    revokedAt: string;
  },
) {
  const result = await db.query<ChannelProviderSecretVersionRow>(
    `update channel_provider_secret_versions
     set revoked_at = $1, revoked_by = $2
     where tenant_id = $3 and provider = 'whatsapp_twilio'
       and endpoint_id = $4 and secret_scope = $5
       and channel_identity_id is not distinct from $6
       and revoked_at is null
     returning *`,
    [
      input.revokedAt,
      input.actorId,
      input.tenantId,
      input.endpointId,
      input.scope,
      input.channelIdentityId,
    ],
  );
  return result.rows;
}

export async function insertSecretVersion(
  db: DbClient,
  input: Omit<
    ChannelProviderSecretVersionRow,
    "provider" | "revoked_at" | "revoked_by"
  >,
) {
  const result = await db.query<ChannelProviderSecretVersionRow>(
    `insert into channel_provider_secret_versions (
       id, tenant_id, provider, endpoint_id, channel_identity_id,
       secret_scope, encrypted_payload, key_version, secret_version,
       rotation_key_hash, revoked_at, revoked_by, created_by, created_at
     ) values (
       $1, $2, 'whatsapp_twilio', $3, $4, $5, $6, $7, $8, $9,
       null, null, $10, $11
     ) returning *`,
    [
      input.id,
      input.tenant_id,
      input.endpoint_id,
      input.channel_identity_id,
      input.secret_scope,
      input.encrypted_payload,
      input.key_version,
      input.secret_version,
      input.rotation_key_hash,
      input.created_by,
      input.created_at,
    ],
  );
  return result.rows[0];
}

export async function findActiveEndpointSecretVersion(
  db: DbClient,
  tenantId: string,
  endpointId: string,
) {
  const result = await db.query<ChannelProviderSecretVersionRow>(
    `select secret.* from channel_provider_secret_versions secret
     join channel_provider_endpoints endpoint
       on endpoint.tenant_id = secret.tenant_id
      and endpoint.id = secret.endpoint_id
      and endpoint.provider = secret.provider
     where secret.tenant_id = $1 and secret.endpoint_id = $2
       and secret.provider = 'whatsapp_twilio'
       and secret.secret_scope = 'endpoint'
       and secret.channel_identity_id is null
       and secret.revoked_at is null and endpoint.status = 'active'
     order by secret.secret_version desc
     limit 1`,
    [tenantId, endpointId],
  );
  return result.rows[0] ?? null;
}

export async function findActiveIdentitySecretVersion(
  db: DbClient,
  tenantId: string,
  endpointId: string,
  channelIdentityId: string,
) {
  const result = await db.query<ChannelProviderSecretVersionRow>(
    `select secret.* from channel_provider_secret_versions secret
     join channel_provider_endpoints endpoint
       on endpoint.tenant_id = secret.tenant_id
      and endpoint.id = secret.endpoint_id
      and endpoint.provider = secret.provider
     join conversation_channel_identities identity
       on identity.tenant_id = secret.tenant_id
      and identity.id = secret.channel_identity_id
     where secret.tenant_id = $1 and secret.endpoint_id = $2
       and secret.channel_identity_id = $3
       and secret.provider = 'whatsapp_twilio'
       and secret.secret_scope = 'identity'
       and secret.revoked_at is null and endpoint.status = 'active'
       and identity.adapter_key = 'whatsapp-twilio'
       and identity.state = 'active'
     order by secret.secret_version desc
     limit 1`,
    [tenantId, endpointId, channelIdentityId],
  );
  return result.rows[0] ?? null;
}
