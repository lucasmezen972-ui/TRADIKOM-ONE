import type { DbClient } from "@/lib/db";

export type ChannelProviderSecretProvider =
  | "whatsapp_twilio"
  | "whatsapp_meta";
export type ChannelProviderSecretScope = "endpoint" | "identity";

export type ChannelProviderSecretVersionRow = {
  id: string;
  tenant_id: string;
  provider: ChannelProviderSecretProvider;
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

export async function lockActiveChannelProviderEndpoint(
  db: DbClient,
  tenantId: string,
  endpointId: string,
  provider: ChannelProviderSecretProvider,
) {
  const result = await db.query<{ id: string; external_account_id: string }>(
    `select id, external_account_id from channel_provider_endpoints
     where tenant_id = $1 and id = $2 and provider = $3 and status = 'active'
     for update`,
    [tenantId, endpointId, provider],
  );
  return result.rows[0] ?? null;
}

export async function lockChannelProviderEndpoint(
  db: DbClient,
  tenantId: string,
  endpointId: string,
  provider: ChannelProviderSecretProvider,
) {
  const result = await db.query<{ id: string; status: "active" | "disabled" }>(
    `select id, status from channel_provider_endpoints
     where tenant_id = $1 and id = $2 and provider = $3
     for update`,
    [tenantId, endpointId, provider],
  );
  return result.rows[0] ?? null;
}

export async function findActiveChannelProviderIdentity(
  db: DbClient,
  input: {
    tenantId: string;
    endpointId: string;
    channelIdentityId: string;
    provider: ChannelProviderSecretProvider;
  },
) {
  const result = await db.query<{ id: string }>(
    `select identity.id from conversation_channel_identities identity
     where identity.tenant_id = $1 and identity.id = $2
       and identity.adapter_key = case
         when $4 = 'whatsapp_twilio' then 'whatsapp-twilio'
         else 'whatsapp-meta'
       end
       and identity.state = 'active'
       and (
         $4 = 'whatsapp_twilio'
         or exists (
           select 1 from channel_provider_identity_bindings binding
           where binding.tenant_id = identity.tenant_id
             and binding.provider = $4
             and binding.endpoint_id = $3
             and binding.channel_identity_id = identity.id
         )
       )`,
    [
      input.tenantId,
      input.channelIdentityId,
      input.endpointId,
      input.provider,
    ],
  );
  return result.rows[0] ?? null;
}

export async function findChannelProviderIdentity(
  db: DbClient,
  input: {
    tenantId: string;
    endpointId: string;
    channelIdentityId: string;
    provider: ChannelProviderSecretProvider;
  },
) {
  const result = await db.query<{ id: string; state: string }>(
    `select identity.id, identity.state
     from conversation_channel_identities identity
     where identity.tenant_id = $1 and identity.id = $2
       and identity.adapter_key = case
         when $4 = 'whatsapp_twilio' then 'whatsapp-twilio'
         else 'whatsapp-meta'
       end
       and (
         $4 = 'whatsapp_twilio'
         or exists (
           select 1 from channel_provider_identity_bindings binding
           where binding.tenant_id = identity.tenant_id
             and binding.provider = $4
             and binding.endpoint_id = $3
             and binding.channel_identity_id = identity.id
         )
       )`,
    [
      input.tenantId,
      input.channelIdentityId,
      input.endpointId,
      input.provider,
    ],
  );
  return result.rows[0] ?? null;
}

export async function findSecretVersionByRotationKey(
  db: DbClient,
  tenantId: string,
  provider: ChannelProviderSecretProvider,
  rotationKeyHash: string,
) {
  const result = await db.query<ChannelProviderSecretVersionRow>(
    `select * from channel_provider_secret_versions
     where tenant_id = $1 and provider = $2 and rotation_key_hash = $3`,
    [tenantId, provider, rotationKeyHash],
  );
  return result.rows[0] ?? null;
}

export async function nextSecretVersion(
  db: DbClient,
  input: {
    tenantId: string;
    provider: ChannelProviderSecretProvider;
    endpointId: string;
    channelIdentityId: string | null;
    scope: ChannelProviderSecretScope;
  },
) {
  const result = await db.query<{ next_version: number }>(
    `select coalesce(max(secret_version), 0) + 1 as next_version
     from channel_provider_secret_versions
     where tenant_id = $1 and provider = $2
       and endpoint_id = $3 and secret_scope = $4
       and channel_identity_id is not distinct from $5`,
    [
      input.tenantId,
      input.provider,
      input.endpointId,
      input.scope,
      input.channelIdentityId,
    ],
  );
  return Number(result.rows[0]?.next_version ?? 1);
}

export async function revokeActiveSecretVersions(
  db: DbClient,
  input: {
    tenantId: string;
    provider: ChannelProviderSecretProvider;
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
     where tenant_id = $3 and provider = $4
       and endpoint_id = $5 and secret_scope = $6
       and channel_identity_id is not distinct from $7
       and revoked_at is null
     returning *`,
    [
      input.revokedAt,
      input.actorId,
      input.tenantId,
      input.provider,
      input.endpointId,
      input.scope,
      input.channelIdentityId,
    ],
  );
  return result.rows;
}

export async function insertSecretVersion(
  db: DbClient,
  input: Omit<ChannelProviderSecretVersionRow, "revoked_at" | "revoked_by">,
) {
  const result = await db.query<ChannelProviderSecretVersionRow>(
    `insert into channel_provider_secret_versions (
       id, tenant_id, provider, endpoint_id, channel_identity_id,
       secret_scope, encrypted_payload, key_version, secret_version,
       rotation_key_hash, revoked_at, revoked_by, created_by, created_at
     ) values (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
       null, null, $11, $12
     ) returning *`,
    [
      input.id,
      input.tenant_id,
      input.provider,
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
  provider: ChannelProviderSecretProvider,
) {
  const result = await db.query<ChannelProviderSecretVersionRow>(
    `select secret.* from channel_provider_secret_versions secret
     join channel_provider_endpoints endpoint
       on endpoint.tenant_id = secret.tenant_id
      and endpoint.id = secret.endpoint_id
      and endpoint.provider = secret.provider
     where secret.tenant_id = $1 and secret.endpoint_id = $2
       and secret.provider = $3 and secret.secret_scope = 'endpoint'
       and secret.channel_identity_id is null
       and secret.revoked_at is null and endpoint.status = 'active'
     order by secret.secret_version desc
     limit 1`,
    [tenantId, endpointId, provider],
  );
  return result.rows[0] ?? null;
}

export async function findActiveIdentitySecretVersion(
  db: DbClient,
  tenantId: string,
  endpointId: string,
  channelIdentityId: string,
  provider: ChannelProviderSecretProvider,
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
       and secret.provider = $4 and secret.secret_scope = 'identity'
       and secret.revoked_at is null and endpoint.status = 'active'
       and identity.adapter_key = case
         when $4 = 'whatsapp_twilio' then 'whatsapp-twilio'
         else 'whatsapp-meta'
       end
       and identity.state = 'active'
       and (
         $4 = 'whatsapp_twilio'
         or exists (
           select 1 from channel_provider_identity_bindings binding
           where binding.tenant_id = secret.tenant_id
             and binding.provider = secret.provider
             and binding.endpoint_id = secret.endpoint_id
             and binding.channel_identity_id = secret.channel_identity_id
         )
       )
     order by secret.secret_version desc
     limit 1`,
    [tenantId, endpointId, channelIdentityId, provider],
  );
  return result.rows[0] ?? null;
}
