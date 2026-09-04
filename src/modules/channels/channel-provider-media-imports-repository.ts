import type { DbClient } from "@/lib/db";
import type { ChannelProviderMediaReference } from "@/modules/channels/channel-provider-media-reference-crypto";

export type ChannelProviderMediaImportStatus =
  | "not_configured"
  | "pending"
  | "failed";

export type ChannelProviderMediaImportRow = {
  id: string;
  tenant_id: string;
  provider: "whatsapp_meta";
  endpoint_id: string;
  message_id: string;
  media_kind: ChannelProviderMediaReference["mediaKind"];
  reservation_status: ChannelProviderMediaImportStatus;
  encrypted_provider_reference: string | null;
  key_version: string | null;
  request_fingerprint: string;
  safe_error_code:
    | "media_reference_vault_not_configured"
    | "media_reference_encryption_failed"
    | null;
  created_at: string;
  updated_at: string;
};

export async function insertChannelProviderMediaImportReservation(
  db: DbClient,
  input: ChannelProviderMediaImportRow,
) {
  const result = await db.query<ChannelProviderMediaImportRow>(
    `insert into channel_provider_media_imports (
       id, tenant_id, provider, endpoint_id, message_id, media_kind,
       reservation_status, encrypted_provider_reference, key_version,
       request_fingerprint, safe_error_code, created_at, updated_at
     ) values (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13
     ) on conflict (tenant_id, provider, message_id) do nothing
     returning *`,
    [
      input.id,
      input.tenant_id,
      input.provider,
      input.endpoint_id,
      input.message_id,
      input.media_kind,
      input.reservation_status,
      input.encrypted_provider_reference,
      input.key_version,
      input.request_fingerprint,
      input.safe_error_code,
      input.created_at,
      input.updated_at,
    ],
  );
  return result.rows[0] ?? null;
}

export async function findChannelProviderMediaImportReservation(
  db: DbClient,
  input: {
    tenantId: string;
    provider: "whatsapp_meta";
    messageId: string;
  },
) {
  const result = await db.query<ChannelProviderMediaImportRow>(
    `select * from channel_provider_media_imports
     where tenant_id = $1 and provider = $2 and message_id = $3`,
    [input.tenantId, input.provider, input.messageId],
  );
  return result.rows[0] ?? null;
}
