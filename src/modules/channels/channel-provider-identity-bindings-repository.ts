import type { DbClient } from "@/lib/db";

export type ChannelProviderIdentityBindingRow = {
  id: string;
  tenant_id: string;
  provider: "whatsapp_meta";
  endpoint_id: string;
  channel_identity_id: string;
  created_at: string;
};

export class ChannelProviderIdentityBindingError extends Error {
  constructor(
    public readonly code:
      | "channel_provider_identity_binding_conflict"
      | "channel_provider_identity_binding_not_found",
    message: string,
  ) {
    super(message);
    this.name = "ChannelProviderIdentityBindingError";
  }
}

/**
 * Lie une identité Meta pseudonymisée à son endpoint d'origine. La même
 * identité ne peut jamais être réattribuée à un autre numéro Meta du tenant.
 */
export async function reserveMetaWhatsAppIdentityBinding(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    endpointId: string;
    channelIdentityId: string;
    createdAt: string;
  },
) {
  const inserted = await db.query<ChannelProviderIdentityBindingRow>(
    `insert into channel_provider_identity_bindings (
       id, tenant_id, provider, endpoint_id, channel_identity_id, created_at
     ) values ($1, $2, 'whatsapp_meta', $3, $4, $5)
     on conflict (tenant_id, provider, channel_identity_id) do nothing
     returning *`,
    [
      input.id,
      input.tenantId,
      input.endpointId,
      input.channelIdentityId,
      input.createdAt,
    ],
  );
  if (inserted.rows[0]) {
    return { row: inserted.rows[0], replayed: false };
  }

  const existing = await db.query<ChannelProviderIdentityBindingRow>(
    `select * from channel_provider_identity_bindings
     where tenant_id = $1
       and provider = 'whatsapp_meta'
       and channel_identity_id = $2`,
    [input.tenantId, input.channelIdentityId],
  );
  const row = existing.rows[0];
  if (!row) {
    throw new ChannelProviderIdentityBindingError(
      "channel_provider_identity_binding_not_found",
      "La liaison d'identité WhatsApp Meta est introuvable.",
    );
  }
  if (row.endpoint_id !== input.endpointId) {
    throw new ChannelProviderIdentityBindingError(
      "channel_provider_identity_binding_conflict",
      "Cette identité WhatsApp Meta appartient à un autre endpoint.",
    );
  }
  return { row, replayed: true };
}
