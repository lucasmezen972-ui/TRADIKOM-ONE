import type { DbClient } from "@/lib/db";

export type MediaImportRuntimeMode = "mock" | "disabled" | "not_configured";
export type MediaImportFailureClassification =
  | "temporary"
  | "permanent"
  | "validation"
  | "policy"
  | "not_configured";

export type ChannelProviderMediaImportExecutionRow = {
  id: string;
  tenant_id: string;
  media_import_id: string;
  provider: "whatsapp_meta";
  provider_mode: MediaImportRuntimeMode;
  storage_mode: MediaImportRuntimeMode;
  status: "reserved" | "succeeded" | "failed" | "denied";
  failure_classification: MediaImportFailureClassification | null;
  safe_error_code: string | null;
  retryable: boolean | number | null;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  last_attempted_at: string | null;
  lease_id: string | null;
  lease_expires_at: string | null;
  attachment_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type ChannelProviderMediaImportContextRow = {
  media_import_id: string;
  tenant_id: string;
  provider: "whatsapp_meta";
  endpoint_id: string;
  message_id: string;
  media_kind: "image" | "audio" | "document" | "video" | "sticker";
  reservation_status: "not_configured" | "pending" | "failed";
  encrypted_provider_reference: string | null;
  key_version: string | null;
  endpoint_status: "active" | "disabled";
  message_status: "received" | "pending" | "sent" | "delivered" | "failed";
};

export async function findChannelProviderMediaImportContext(
  db: DbClient,
  input: { tenantId: string; mediaImportId: string },
) {
  const result = await db.query<ChannelProviderMediaImportContextRow>(
    `select media_import.id as media_import_id,
            media_import.tenant_id,
            media_import.provider,
            media_import.endpoint_id,
            media_import.message_id,
            media_import.media_kind,
            media_import.reservation_status,
            media_import.encrypted_provider_reference,
            media_import.key_version,
            endpoint.status as endpoint_status,
            message.status as message_status
     from channel_provider_media_imports media_import
     join channel_provider_endpoints endpoint
       on endpoint.tenant_id = media_import.tenant_id
      and endpoint.id = media_import.endpoint_id
      and endpoint.provider = media_import.provider
     join conversation_messages message
       on message.tenant_id = media_import.tenant_id
      and message.id = media_import.message_id
     where media_import.tenant_id = $1 and media_import.id = $2`,
    [input.tenantId, input.mediaImportId],
  );
  return result.rows[0] ?? null;
}

export async function reserveChannelProviderMediaImportExecution(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    mediaImportId: string;
    providerMode: MediaImportRuntimeMode;
    storageMode: MediaImportRuntimeMode;
    maxAttempts: number;
    actorId: string;
    occurredAt: string;
  },
) {
  const result = await db.query<ChannelProviderMediaImportExecutionRow>(
    `insert into channel_provider_media_import_executions (
       id, tenant_id, media_import_id, provider, provider_mode, storage_mode,
       status, failure_classification, safe_error_code, retryable, attempts,
       max_attempts, next_attempt_at, last_attempted_at, lease_id,
       lease_expires_at, attachment_id, created_by, created_at, updated_at
     ) values (
       $1, $2, $3, 'whatsapp_meta', $4, $5, 'reserved', null, null, null, 0,
       $6, $7, null, null, null, null, $8, $7, $7
     )
     on conflict (tenant_id, media_import_id) do nothing
     returning *`,
    [
      input.id,
      input.tenantId,
      input.mediaImportId,
      input.providerMode,
      input.storageMode,
      input.maxAttempts,
      input.occurredAt,
      input.actorId,
    ],
  );
  if (result.rows[0]) return { row: result.rows[0], replayed: false };
  return {
    row: await findChannelProviderMediaImportExecution(db, input),
    replayed: true,
  };
}

export async function findChannelProviderMediaImportExecution(
  db: DbClient,
  input: { tenantId: string; mediaImportId: string },
) {
  const result = await db.query<ChannelProviderMediaImportExecutionRow>(
    `select * from channel_provider_media_import_executions
     where tenant_id = $1 and media_import_id = $2`,
    [input.tenantId, input.mediaImportId],
  );
  return result.rows[0] ?? null;
}

export async function listActionableChannelProviderMediaImports(
  db: DbClient,
  input: { tenantId: string; dueAt: string; limit: number },
) {
  const result = await db.query<{ media_import_id: string }>(
    `select media_import.id as media_import_id
     from channel_provider_media_imports media_import
     left join channel_provider_media_import_executions execution
       on execution.tenant_id = media_import.tenant_id
      and execution.media_import_id = media_import.id
     where media_import.tenant_id = $1
       and media_import.provider = 'whatsapp_meta'
       and media_import.reservation_status = 'pending'
       and (
         execution.id is null
         or (
           execution.attempts < execution.max_attempts
           and execution.next_attempt_at <= $2
           and (execution.lease_id is null or execution.lease_expires_at <= $2)
           and (
             execution.status = 'reserved'
             or (
               execution.status = 'failed'
               and execution.retryable = true
               and execution.failure_classification = 'temporary'
             )
           )
         )
       )
     order by coalesce(execution.next_attempt_at, media_import.created_at) asc,
              media_import.created_at asc,
              media_import.id asc
     limit $3`,
    [input.tenantId, input.dueAt, input.limit],
  );
  return result.rows;
}

export async function claimChannelProviderMediaImportExecution(
  db: DbClient,
  input: {
    tenantId: string;
    mediaImportId: string;
    leaseId: string;
    attemptedAt: string;
    leaseExpiresAt: string;
  },
) {
  const result = await db.query<ChannelProviderMediaImportExecutionRow>(
    `update channel_provider_media_import_executions
     set attempts = attempts + 1,
         last_attempted_at = $1,
         lease_id = $2,
         lease_expires_at = $3,
         updated_at = $1
     where tenant_id = $4
       and media_import_id = $5
       and attempts < max_attempts
       and next_attempt_at <= $1
       and (lease_id is null or lease_expires_at <= $1)
       and (
         status = 'reserved'
         or (
           status = 'failed'
           and retryable = true
           and failure_classification = 'temporary'
         )
       )
     returning *`,
    [
      input.attemptedAt,
      input.leaseId,
      input.leaseExpiresAt,
      input.tenantId,
      input.mediaImportId,
    ],
  );
  return result.rows[0] ?? null;
}

export async function finalizeChannelProviderMediaImportExecution(
  db: DbClient,
  input: {
    tenantId: string;
    mediaImportId: string;
    leaseId: string;
    status: "succeeded" | "failed" | "denied";
    failureClassification: MediaImportFailureClassification | null;
    safeErrorCode: string | null;
    retryable: boolean;
    nextAttemptAt: string;
    attachmentId: string | null;
    updatedAt: string;
  },
) {
  const result = await db.query<ChannelProviderMediaImportExecutionRow>(
    `update channel_provider_media_import_executions
     set status = $1,
         failure_classification = $2,
         safe_error_code = $3,
         retryable = $4,
         next_attempt_at = $5,
         lease_id = null,
         lease_expires_at = null,
         attachment_id = $6,
         updated_at = $7
     where tenant_id = $8
       and media_import_id = $9
       and lease_id = $10
       and status in ('reserved', 'failed')
     returning *`,
    [
      input.status,
      input.failureClassification,
      input.safeErrorCode,
      input.retryable,
      input.nextAttemptAt,
      input.attachmentId,
      input.updatedAt,
      input.tenantId,
      input.mediaImportId,
      input.leaseId,
    ],
  );
  return result.rows[0] ?? null;
}
