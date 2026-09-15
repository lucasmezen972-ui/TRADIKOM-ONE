import type { DbClient } from "@/lib/db";

export type WhatsAppTwilioActivationBudgetContextRow = {
  authorization_id: string;
  tenant_id: string;
  provider: "whatsapp_twilio";
  endpoint_id: string;
  max_messages: number;
  authorized_at: string;
  expires_at: string;
  revoked_at: string | null;
  delivery_id: string;
  delivery_status: "reserved" | "accepted" | "delivered" | "failed" | "denied";
  delivery_retryable: boolean | number | null;
  delivery_failure_classification: string | null;
  delivery_created_by: string;
  endpoint_status: "active" | "disabled";
};

export type WhatsAppTwilioActivationConsumptionRow = {
  id: string;
  tenant_id: string;
  provider: "whatsapp_twilio";
  endpoint_id: string;
  authorization_id: string;
  delivery_id: string;
  consumed_by: string;
  consumed_at: string;
};

export async function lockWhatsAppActivationBudgetContext(
  db: DbClient,
  input: {
    tenantId: string;
    endpointId: string;
    authorizationId: string;
    deliveryId: string;
  },
) {
  const result = await db.query<WhatsAppTwilioActivationBudgetContextRow>(
    `select authz.id as authorization_id,
            authz.tenant_id,
            authz.provider,
            authz.endpoint_id,
            authz.max_messages,
            authz.authorized_at,
            authz.expires_at,
            authz.revoked_at,
            delivery.id as delivery_id,
            delivery.status as delivery_status,
            delivery.retryable as delivery_retryable,
            delivery.failure_classification as delivery_failure_classification,
            delivery.created_by as delivery_created_by,
            endpoint.status as endpoint_status
     from channel_provider_activation_authorizations authz
     join channel_provider_endpoints endpoint
       on endpoint.tenant_id = authz.tenant_id
      and endpoint.id = authz.endpoint_id
      and endpoint.provider = authz.provider
     join channel_provider_deliveries delivery
       on delivery.tenant_id = authz.tenant_id
      and delivery.provider = authz.provider
      and delivery.endpoint_id = authz.endpoint_id
     where authz.tenant_id = $1
       and authz.endpoint_id = $2
       and authz.id = $3
       and delivery.id = $4
       and authz.provider = 'whatsapp_twilio'
       and endpoint.status = 'active'
     for update of authz`,
    [input.tenantId, input.endpointId, input.authorizationId, input.deliveryId],
  );
  return result.rows[0] ?? null;
}

export async function findWhatsAppActivationConsumptionByDelivery(
  db: DbClient,
  input: { tenantId: string; deliveryId: string },
) {
  const result = await db.query<WhatsAppTwilioActivationConsumptionRow>(
    `select * from channel_provider_activation_consumptions
     where tenant_id = $1
       and provider = 'whatsapp_twilio'
       and delivery_id = $2`,
    [input.tenantId, input.deliveryId],
  );
  return result.rows[0] ?? null;
}

export async function countWhatsAppActivationConsumptions(
  db: DbClient,
  input: { tenantId: string; authorizationId: string },
) {
  const result = await db.query<{ count: number }>(
    `select count(*)::integer as count
     from channel_provider_activation_consumptions
     where tenant_id = $1 and authorization_id = $2`,
    [input.tenantId, input.authorizationId],
  );
  return result.rows[0]?.count ?? 0;
}

export async function insertWhatsAppActivationConsumption(
  db: DbClient,
  input: WhatsAppTwilioActivationConsumptionRow,
) {
  const result = await db.query<WhatsAppTwilioActivationConsumptionRow>(
    `insert into channel_provider_activation_consumptions (
       id, tenant_id, provider, endpoint_id, authorization_id, delivery_id,
       consumed_by, consumed_at
     ) values ($1, $2, 'whatsapp_twilio', $3, $4, $5, $6, $7)
     returning *`,
    [
      input.id,
      input.tenant_id,
      input.endpoint_id,
      input.authorization_id,
      input.delivery_id,
      input.consumed_by,
      input.consumed_at,
    ],
  );
  return result.rows[0] ?? null;
}
