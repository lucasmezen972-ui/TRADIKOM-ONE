import type { DbClient } from "@/lib/db";
import type { ExternalChannelProvider } from "@/modules/channels/contracts";

export type ChannelProviderEndpointRow = {
  id: string;
  tenant_id: string;
  provider: ExternalChannelProvider;
  external_account_id: string;
  destination_fingerprint: string;
  status: "active" | "disabled";
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type MetaWhatsAppTenantConfigurationSummary = {
  has_endpoint: boolean;
  has_active_endpoint: boolean;
  has_configured_endpoint: boolean;
};

export async function inspectMetaWhatsAppTenantConfiguration(
  db: DbClient,
  tenantId: string,
) {
  const result = await db.query<MetaWhatsAppTenantConfigurationSummary>(
    `select
       exists (
         select 1 from channel_provider_endpoints endpoint
         where endpoint.tenant_id = $1
           and endpoint.provider = 'whatsapp_meta'
       ) as has_endpoint,
       exists (
         select 1 from channel_provider_endpoints endpoint
         where endpoint.tenant_id = $1
           and endpoint.provider = 'whatsapp_meta'
           and endpoint.status = 'active'
       ) as has_active_endpoint,
       exists (
         select 1
         from channel_provider_endpoints endpoint
         join channel_provider_secret_versions secret
           on secret.tenant_id = endpoint.tenant_id
          and secret.provider = endpoint.provider
          and secret.endpoint_id = endpoint.id
          and secret.secret_scope = 'endpoint'
          and secret.channel_identity_id is null
          and secret.revoked_at is null
         where endpoint.tenant_id = $1
           and endpoint.provider = 'whatsapp_meta'
           and endpoint.status = 'active'
       ) as has_configured_endpoint`,
    [tenantId],
  );
  return (
    result.rows[0] ?? {
      has_endpoint: false,
      has_active_endpoint: false,
      has_configured_endpoint: false,
    }
  );
}

export async function reserveChannelProviderEndpoint(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    provider: ExternalChannelProvider;
    externalAccountId: string;
    destinationFingerprint: string;
    actorId: string;
    occurredAt: string;
  },
) {
  const inserted = await db.query<ChannelProviderEndpointRow>(
    `insert into channel_provider_endpoints (
       id, tenant_id, provider, external_account_id,
       destination_fingerprint, status, created_by, created_at, updated_at
     ) values ($1, $2, $3, $4, $5, 'active', $6, $7, $7)
     on conflict (provider, external_account_id, destination_fingerprint)
     do nothing
     returning *`,
    [
      input.id,
      input.tenantId,
      input.provider,
      input.externalAccountId,
      input.destinationFingerprint,
      input.actorId,
      input.occurredAt,
    ],
  );
  if (inserted.rows[0]) {
    return { row: inserted.rows[0], replayed: false };
  }

  const existing = await db.query<ChannelProviderEndpointRow>(
    `select * from channel_provider_endpoints
     where tenant_id = $1
       and provider = $2
       and external_account_id = $3
       and destination_fingerprint = $4`,
    [
      input.tenantId,
      input.provider,
      input.externalAccountId,
      input.destinationFingerprint,
    ],
  );
  return { row: existing.rows[0] ?? null, replayed: true };
}

export async function findChannelProviderEndpointById(
  db: DbClient,
  tenantId: string,
  endpointId: string,
  provider: ExternalChannelProvider,
) {
  const result = await db.query<ChannelProviderEndpointRow>(
    `select * from channel_provider_endpoints
     where tenant_id = $1 and id = $2 and provider = $3`,
    [tenantId, endpointId, provider],
  );
  return result.rows[0] ?? null;
}

export async function updateChannelProviderEndpointStatus(
  db: DbClient,
  input: {
    tenantId: string;
    endpointId: string;
    provider: ExternalChannelProvider;
    status: "active" | "disabled";
    updatedAt: string;
  },
) {
  const result = await db.query<ChannelProviderEndpointRow>(
    `update channel_provider_endpoints
     set status = $1, updated_at = $2
     where tenant_id = $3 and id = $4 and provider = $5
     returning *`,
    [
      input.status,
      input.updatedAt,
      input.tenantId,
      input.endpointId,
      input.provider,
    ],
  );
  return result.rows[0] ?? null;
}

export async function findActiveChannelProviderEndpointByFingerprint(
  db: DbClient,
  input: {
    provider: ExternalChannelProvider;
    externalAccountId: string;
    destinationFingerprint: string;
  },
) {
  const result = await db.query<ChannelProviderEndpointRow>(
    `select * from channel_provider_endpoints
     where provider = $1
       and external_account_id = $2
       and destination_fingerprint = $3
       and status = 'active'`,
    [input.provider, input.externalAccountId, input.destinationFingerprint],
  );
  return result.rows[0] ?? null;
}
