import type { DbClient } from "@/lib/db";

export type WhatsAppTwilioActivationAuthorizationRow = {
  id: string;
  tenant_id: string;
  provider: "whatsapp_twilio";
  endpoint_id: string;
  authorization_scope: "twilio_whatsapp_sandbox";
  max_messages: number;
  free_units_confirmed: boolean;
  idempotency_key_hash: string;
  authorized_by: string;
  authorized_at: string;
  expires_at: string;
  revoked_at: string | null;
  revoked_by: string | null;
};

export async function lockActiveWhatsAppEndpointForAuthorization(
  db: DbClient,
  tenantId: string,
  endpointId: string,
) {
  const result = await db.query<{ id: string }>(
    `select id from channel_provider_endpoints
     where tenant_id = $1 and id = $2
       and provider = 'whatsapp_twilio' and status = 'active'
     for update`,
    [tenantId, endpointId],
  );
  return result.rows[0] ?? null;
}

export async function findWhatsAppActivationAuthorizationByIdempotencyKey(
  db: DbClient,
  tenantId: string,
  idempotencyKeyHash: string,
) {
  const result = await db.query<WhatsAppTwilioActivationAuthorizationRow>(
    `select * from channel_provider_activation_authorizations
     where tenant_id = $1 and provider = 'whatsapp_twilio'
       and idempotency_key_hash = $2`,
    [tenantId, idempotencyKeyHash],
  );
  return result.rows[0] ?? null;
}

export async function insertWhatsAppActivationAuthorization(
  db: DbClient,
  input: Omit<
    WhatsAppTwilioActivationAuthorizationRow,
    "provider" | "authorization_scope" | "revoked_at" | "revoked_by"
  >,
) {
  const result = await db.query<WhatsAppTwilioActivationAuthorizationRow>(
    `insert into channel_provider_activation_authorizations (
       id, tenant_id, provider, endpoint_id, authorization_scope,
       max_messages, free_units_confirmed, idempotency_key_hash,
       authorized_by, authorized_at, expires_at, revoked_at, revoked_by
     ) values (
       $1, $2, 'whatsapp_twilio', $3, 'twilio_whatsapp_sandbox',
       $4, $5, $6, $7, $8, $9, null, null
     ) on conflict (tenant_id, provider, idempotency_key_hash)
       do nothing
     returning *`,
    [
      input.id,
      input.tenant_id,
      input.endpoint_id,
      input.max_messages,
      input.free_units_confirmed,
      input.idempotency_key_hash,
      input.authorized_by,
      input.authorized_at,
      input.expires_at,
    ],
  );
  return result.rows[0] ?? null;
}

export async function findWhatsAppActivationAuthorizationByReference(
  db: DbClient,
  input: { tenantId: string; endpointId: string; authorizationId: string },
) {
  const result = await db.query<WhatsAppTwilioActivationAuthorizationRow>(
    `select authz.*
     from channel_provider_activation_authorizations authz
     join channel_provider_endpoints endpoint
       on endpoint.tenant_id = authz.tenant_id
      and endpoint.id = authz.endpoint_id
      and endpoint.provider = authz.provider
     where authz.tenant_id = $1
       and authz.endpoint_id = $2
       and authz.id = $3
       and authz.provider = 'whatsapp_twilio'`,
    [input.tenantId, input.endpointId, input.authorizationId],
  );
  return result.rows[0] ?? null;
}

export async function findWhatsAppActivationAuthorizationById(
  db: DbClient,
  tenantId: string,
  authorizationId: string,
) {
  const result = await db.query<WhatsAppTwilioActivationAuthorizationRow>(
    `select * from channel_provider_activation_authorizations
     where tenant_id = $1 and id = $2 and provider = 'whatsapp_twilio'`,
    [tenantId, authorizationId],
  );
  return result.rows[0] ?? null;
}

export async function revokeWhatsAppActivationAuthorizationRow(
  db: DbClient,
  input: {
    tenantId: string;
    authorizationId: string;
    actorId: string;
    revokedAt: string;
  },
) {
  const result = await db.query<WhatsAppTwilioActivationAuthorizationRow>(
    `update channel_provider_activation_authorizations
     set revoked_at = $1, revoked_by = $2
     where tenant_id = $3 and id = $4
       and provider = 'whatsapp_twilio' and revoked_at is null
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
