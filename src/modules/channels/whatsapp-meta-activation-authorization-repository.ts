import type { DbClient } from "@/lib/db";

export type WhatsAppMetaActivationAuthorizationRow = {
  id: string;
  tenant_id: string;
  provider: "whatsapp_meta";
  endpoint_id: string;
  authorization_scope: "meta_whatsapp_trial";
  max_messages: 1;
  free_units_confirmed: boolean;
  idempotency_key_hash: string;
  authorized_by: string;
  authorized_at: string;
  expires_at: string;
  revoked_at: string | null;
  revoked_by: string | null;
};

export async function lockActiveMetaWhatsAppEndpointForAuthorization(
  db: DbClient,
  tenantId: string,
  endpointId: string,
) {
  const result = await db.query<{ id: string }>(
    `select id from channel_provider_endpoints
     where tenant_id = $1 and id = $2
       and provider = 'whatsapp_meta' and status = 'active'
     for update`,
    [tenantId, endpointId],
  );
  return result.rows[0] ?? null;
}

export async function findMetaWhatsAppAuthorizationByIdempotencyKey(
  db: DbClient,
  tenantId: string,
  idempotencyKeyHash: string,
) {
  const result = await db.query<WhatsAppMetaActivationAuthorizationRow>(
    `select * from channel_provider_activation_authorizations
     where tenant_id = $1 and provider = 'whatsapp_meta'
       and idempotency_key_hash = $2`,
    [tenantId, idempotencyKeyHash],
  );
  return result.rows[0] ?? null;
}

export async function insertMetaWhatsAppTrialAuthorization(
  db: DbClient,
  input: Omit<
    WhatsAppMetaActivationAuthorizationRow,
    | "provider"
    | "authorization_scope"
    | "max_messages"
    | "revoked_at"
    | "revoked_by"
  >,
) {
  const result = await db.query<WhatsAppMetaActivationAuthorizationRow>(
    `insert into channel_provider_activation_authorizations (
       id, tenant_id, provider, endpoint_id, authorization_scope,
       max_messages, free_units_confirmed, idempotency_key_hash,
       authorized_by, authorized_at, expires_at, revoked_at, revoked_by
     ) values (
       $1, $2, 'whatsapp_meta', $3, 'meta_whatsapp_trial',
       1, $4, $5, $6, $7, $8, null, null
     ) on conflict (tenant_id, provider, idempotency_key_hash)
       do nothing
     returning *`,
    [
      input.id,
      input.tenant_id,
      input.endpoint_id,
      input.free_units_confirmed,
      input.idempotency_key_hash,
      input.authorized_by,
      input.authorized_at,
      input.expires_at,
    ],
  );
  return result.rows[0] ?? null;
}

export async function findMetaWhatsAppAuthorizationByReference(
  db: DbClient,
  input: { tenantId: string; endpointId: string; authorizationId: string },
) {
  const result = await db.query<WhatsAppMetaActivationAuthorizationRow>(
    `select authz.*
     from channel_provider_activation_authorizations authz
     join channel_provider_endpoints endpoint
       on endpoint.tenant_id = authz.tenant_id
      and endpoint.id = authz.endpoint_id
      and endpoint.provider = authz.provider
     where authz.tenant_id = $1
       and authz.endpoint_id = $2
       and authz.id = $3
       and authz.provider = 'whatsapp_meta'`,
    [input.tenantId, input.endpointId, input.authorizationId],
  );
  return result.rows[0] ?? null;
}

export async function findMetaWhatsAppAuthorizationById(
  db: DbClient,
  tenantId: string,
  authorizationId: string,
) {
  const result = await db.query<WhatsAppMetaActivationAuthorizationRow>(
    `select * from channel_provider_activation_authorizations
     where tenant_id = $1 and id = $2 and provider = 'whatsapp_meta'`,
    [tenantId, authorizationId],
  );
  return result.rows[0] ?? null;
}

export async function revokeMetaWhatsAppAuthorizationRow(
  db: DbClient,
  input: {
    tenantId: string;
    authorizationId: string;
    actorId: string;
    revokedAt: string;
  },
) {
  const result = await db.query<WhatsAppMetaActivationAuthorizationRow>(
    `update channel_provider_activation_authorizations
     set revoked_at = $1, revoked_by = $2
     where tenant_id = $3 and id = $4
       and provider = 'whatsapp_meta' and revoked_at is null
     returning *`,
    [
      input.revokedAt,
      input.actorId,
      input.tenantId,
      input.authorizationId,
    ],
  );
  return result.rows[0] ?? null;
}
