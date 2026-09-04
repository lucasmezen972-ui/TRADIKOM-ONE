import { createHash } from "node:crypto";
import { z } from "zod";
import { withTenantDbTransaction } from "@/db/tenant-context";
import type { DbClient } from "@/lib/db";
import { hashToken, id, nowIso } from "@/lib/security";
import type { Role } from "@/lib/types";
import { recordAuditLog } from "@/modules/audit";
import type {
  ChannelProviderMediaReference,
  ChannelProviderMediaReferenceCipher,
} from "@/modules/channels/channel-provider-media-reference-crypto";
import {
  claimChannelProviderMediaImportExecution,
  finalizeChannelProviderMediaImportExecution,
  findChannelProviderMediaImportContext,
  findChannelProviderMediaImportExecution,
  listActionableChannelProviderMediaImports,
  listActionableChannelProviderMediaImportsForSystem,
  reserveChannelProviderMediaImportExecution,
  type ChannelProviderMediaImportExecutionRow,
  type MediaImportFailureClassification,
  type MediaImportRuntimeMode,
} from "@/modules/channels/channel-provider-media-import-executions-repository";
import { insertConversationAttachment } from "@/modules/conversation-hub/repository";
import { assertTenantAccess } from "@/modules/tenants";

const maxCanonicalAttachmentBytes = 25 * 1024 * 1024;
const defaultMaxAttempts = 3;
const defaultLeaseMs = 60_000;
const defaultBaseBackoffMs = 1_000;
const systemActorId = "system_whatsapp_meta";
const workerRoles: Role[] = [
  "owner",
  "administrator",
  "manager",
  "collaborator",
];
const boundedIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const safeErrorCodeSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-z][a-z0-9_]*$/);
const mediaTypeSchema = z
  .string()
  .trim()
  .min(3)
  .max(120)
  .regex(/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/);
const storageReferenceSchema = z
  .string()
  .trim()
  .min(1)
  .max(512)
  .regex(/^mock:[A-Za-z0-9][A-Za-z0-9/_.:-]*$/);
const processInputSchema = z
  .object({
    tenantId: boundedIdentifierSchema,
    mediaImportId: boundedIdentifierSchema,
  })
  .strict();

export type MediaImportFailureResult = {
  status: "failed";
  classification: "temporary" | "permanent";
  safeErrorCode: string;
  retryable: boolean;
};

export type MetaWhatsAppMediaFetchAdapter = {
  readonly state: MediaImportRuntimeMode;
  fetch(input: {
    tenantId: string;
    endpointId: string;
    mediaId: string;
    idempotencyKey: string;
    maxBytes: number;
  }): Promise<
    | { status: "succeeded"; bytes: Uint8Array; mediaType: string }
    | MediaImportFailureResult
  >;
};

export type ImmutableMediaStorageAdapter = {
  readonly state: MediaImportRuntimeMode;
  store(input: {
    tenantId: string;
    mediaImportId: string;
    idempotencyKey: string;
    bytes: Uint8Array;
    mediaType: string;
    checksumSha256: string;
  }): Promise<
    | { status: "succeeded"; storageReference: string }
    | MediaImportFailureResult
  >;
};

export type MediaImportPolicyEvaluator = (input: {
  tenantId: string;
  actorId: string;
  mediaImportId: string;
  provider: "whatsapp_meta";
  mediaKind: ChannelProviderMediaReference["mediaKind"];
}) =>
  | { allowed: true }
  | { allowed: false; code: string }
  | Promise<{ allowed: true } | { allowed: false; code: string }>;

export type ChannelProviderMediaImportDependencies = {
  cipher?: ChannelProviderMediaReferenceCipher;
  provider: MetaWhatsAppMediaFetchAdapter;
  storage: ImmutableMediaStorageAdapter;
  evaluatePolicy: MediaImportPolicyEvaluator;
};

export type ChannelProviderMediaImportWorkerOptions = {
  now?: Date;
  maxAttempts?: number;
  maxBytes?: number;
  leaseMs?: number;
  baseBackoffMs?: number;
  limit?: number;
};

export type ChannelProviderMediaImportWorkerSummary = {
  state: MediaImportRuntimeMode;
  selected: number;
  processed: number;
  succeeded: number;
  retried: number;
  failed: number;
  skipped: number;
};

type MediaImportExecutionIdentity = {
  actorId: string;
  access: "tenant_member" | "system";
};

export class ChannelProviderMediaImportWorkerError extends Error {
  constructor(
    readonly code:
      | "channel_provider_media_import_not_found"
      | "channel_provider_media_import_not_actionable"
      | "channel_provider_media_import_runtime_mismatch",
  ) {
    super("L'import média fournisseur ne peut pas être traité.");
    this.name = "ChannelProviderMediaImportWorkerError";
  }
}

/**
 * Activité bornée : seuls des doubles explicitement `mock` peuvent lire et
 * stocker des octets. Les modes réels ou ambigus restent fermés par défaut.
 */
export async function processMetaWhatsAppMediaImport(
  db: DbClient,
  actorId: string,
  input: z.input<typeof processInputSchema>,
  dependencies: ChannelProviderMediaImportDependencies,
  options: ChannelProviderMediaImportWorkerOptions = {},
) {
  return processMetaWhatsAppMediaImportAs(
    db,
    { actorId, access: "tenant_member" },
    input,
    dependencies,
    options,
  );
}

async function processMetaWhatsAppMediaImportAs(
  db: DbClient,
  identity: MediaImportExecutionIdentity,
  input: z.input<typeof processInputSchema>,
  dependencies: ChannelProviderMediaImportDependencies,
  options: ChannelProviderMediaImportWorkerOptions,
) {
  const parsed = processInputSchema.parse(input);
  const now = options.now ?? new Date(nowIso());
  const occurredAt = now.toISOString();
  const maxAttempts = boundedInteger(options.maxAttempts, defaultMaxAttempts, 10);
  const execution = await withTenantDbTransaction(
    db,
    parsed.tenantId,
    identity.actorId,
    async (transaction) => {
      if (identity.access === "tenant_member") {
        await assertWorkerAccess(transaction, identity.actorId, parsed.tenantId);
      }
      const context = await findChannelProviderMediaImportContext(transaction, parsed);
      if (!context) throw workerError("channel_provider_media_import_not_found");
      if (
        context.reservation_status !== "pending" ||
        !context.encrypted_provider_reference ||
        !context.key_version
      ) {
        throw workerError("channel_provider_media_import_not_actionable");
      }
      const reservation = await reserveChannelProviderMediaImportExecution(
        transaction,
        {
          id: id("channel_media_import_execution"),
          tenantId: parsed.tenantId,
          mediaImportId: parsed.mediaImportId,
          providerMode: dependencies.provider.state,
          storageMode: dependencies.storage.state,
          maxAttempts,
          actorId:
            identity.access === "system"
              ? context.endpoint_created_by
              : identity.actorId,
          occurredAt,
        },
      );
      if (!reservation.row) throw workerError("channel_provider_media_import_not_found");
      if (
        reservation.row.provider_mode !== dependencies.provider.state ||
        reservation.row.storage_mode !== dependencies.storage.state
      ) {
        throw workerError("channel_provider_media_import_runtime_mismatch");
      }
      if (!reservation.replayed) {
        await auditExecution(
          transaction,
          identity.actorId,
          reservation.row,
          "reserved",
        );
      }
      return reservation.row;
    },
  );

  return attemptMetaWhatsAppMediaImportAs(
    db,
    identity,
    { tenantId: parsed.tenantId, mediaImportId: execution.media_import_id },
    dependencies,
    options,
  );
}

export async function attemptMetaWhatsAppMediaImport(
  db: DbClient,
  actorId: string,
  input: z.input<typeof processInputSchema>,
  dependencies: ChannelProviderMediaImportDependencies,
  options: ChannelProviderMediaImportWorkerOptions = {},
) {
  return attemptMetaWhatsAppMediaImportAs(
    db,
    { actorId, access: "tenant_member" },
    input,
    dependencies,
    options,
  );
}

async function attemptMetaWhatsAppMediaImportAs(
  db: DbClient,
  identity: MediaImportExecutionIdentity,
  input: z.input<typeof processInputSchema>,
  dependencies: ChannelProviderMediaImportDependencies,
  options: ChannelProviderMediaImportWorkerOptions,
) {
  const parsed = processInputSchema.parse(input);
  const attemptedAt = options.now ?? new Date(nowIso());
  const attemptedAtIso = attemptedAt.toISOString();
  const leaseMs = boundedInteger(options.leaseMs, defaultLeaseMs, 600_000);
  const leaseId = id("channel_media_import_lease");
  const leaseExpiresAt = new Date(attemptedAt.getTime() + leaseMs).toISOString();

  const prepared = await withTenantDbTransaction(
    db,
    parsed.tenantId,
    identity.actorId,
    async (transaction) => {
      if (identity.access === "tenant_member") {
        await assertWorkerAccess(transaction, identity.actorId, parsed.tenantId);
      }
      const beforeClaim = await findChannelProviderMediaImportExecution(
        transaction,
        parsed,
      );
      if (!beforeClaim) throw workerError("channel_provider_media_import_not_found");
      const claimed = await claimChannelProviderMediaImportExecution(transaction, {
        ...parsed,
        leaseId,
        attemptedAt: attemptedAtIso,
        leaseExpiresAt,
      });
      if (!claimed) return { row: beforeClaim, replayed: true as const };

      await auditExecution(transaction, identity.actorId, claimed, "attempted");
      const context = await findChannelProviderMediaImportContext(transaction, parsed);
      if (
        !context ||
        context.reservation_status !== "pending" ||
        context.endpoint_status !== "active" ||
        !context.encrypted_provider_reference ||
        !context.key_version
      ) {
        return finalizeWithoutIo(
          transaction,
          identity.actorId,
          claimed,
          leaseId,
          attemptedAtIso,
          "validation",
          "media_import_context_invalid",
        );
      }
      if (
        claimed.provider_mode !== dependencies.provider.state ||
        claimed.storage_mode !== dependencies.storage.state
      ) {
        return finalizeWithoutIo(
          transaction,
          identity.actorId,
          claimed,
          leaseId,
          attemptedAtIso,
          "validation",
          "media_runtime_mode_mismatch",
        );
      }
      if (claimed.provider_mode !== "mock" || claimed.storage_mode !== "mock") {
        const code =
          claimed.provider_mode === "disabled" || claimed.storage_mode === "disabled"
            ? "media_import_disabled"
            : "media_import_not_configured";
        return finalizeWithoutIo(
          transaction,
          identity.actorId,
          claimed,
          leaseId,
          attemptedAtIso,
          "not_configured",
          code,
        );
      }
      const policy = await evaluatePolicySafely(dependencies.evaluatePolicy, {
        tenantId: parsed.tenantId,
        actorId: identity.actorId,
        mediaImportId: parsed.mediaImportId,
        provider: "whatsapp_meta",
        mediaKind: context.media_kind,
      });
      if (!policy.allowed) {
        return finalizeWithoutIo(
          transaction,
          identity.actorId,
          claimed,
          leaseId,
          attemptedAtIso,
          "policy",
          policy.code,
        );
      }
      if (!dependencies.cipher || dependencies.cipher.keyVersion !== context.key_version) {
        return finalizeWithoutIo(
          transaction,
          identity.actorId,
          claimed,
          leaseId,
          attemptedAtIso,
          "not_configured",
          "media_reference_vault_not_configured",
        );
      }
      try {
        const reference = dependencies.cipher.decrypt(
          context.encrypted_provider_reference,
          {
            tenantId: context.tenant_id,
            endpointId: context.endpoint_id,
            messageId: context.message_id,
            provider: context.provider,
          },
        );
        return {
          row: claimed,
          replayed: false as const,
          request: {
            reference,
            endpointId: context.endpoint_id,
            messageId: context.message_id,
          },
        };
      } catch {
        return finalizeWithoutIo(
          transaction,
          identity.actorId,
          claimed,
          leaseId,
          attemptedAtIso,
          "validation",
          "media_reference_decryption_failed",
        );
      }
    },
  );

  if ("request" in prepared && prepared.request) {
    const idempotencyKey = `media-import:${prepared.row.id}`;
    const maxBytes = boundedInteger(
      options.maxBytes,
      maxCanonicalAttachmentBytes,
      maxCanonicalAttachmentBytes,
    );
    const fetched = await fetchSafely(dependencies.provider, {
      tenantId: parsed.tenantId,
      endpointId: prepared.request.endpointId,
      mediaId: prepared.request.reference.mediaId,
      idempotencyKey,
      maxBytes,
    });
    let outcome: FinalOutcome;
    let attachment: PreparedAttachment | null = null;
    if (fetched.status === "failed") {
      outcome = failureOutcome(fetched);
    } else {
      const validated = validateFetchedMedia(
        fetched,
        prepared.request.reference,
        maxBytes,
      );
      if (!validated.ok) {
        outcome = failedOutcome("validation", validated.code, false);
      } else {
        const stored = await storeSafely(dependencies.storage, {
          tenantId: parsed.tenantId,
          mediaImportId: parsed.mediaImportId,
          idempotencyKey,
          bytes: fetched.bytes,
          mediaType: validated.mediaType,
          checksumSha256: validated.checksumSha256,
        });
        if (stored.status === "failed") {
          outcome = failureOutcome(stored);
        } else {
          outcome = succeededOutcome();
          attachment = {
            id: deterministicAttachmentId(prepared.row.id),
            messageId: prepared.request.messageId,
            kind: attachmentKind(prepared.request.reference.mediaKind),
            fileName: safeFileName(prepared.request.reference),
            mediaType: validated.mediaType,
            sizeBytes: fetched.bytes.byteLength,
            storageReference: stored.storageReference,
            checksumSha256: validated.checksumSha256,
          };
        }
      }
    }
    return finalizeIoOutcome(
      db,
      identity,
      prepared.row,
      leaseId,
      outcome,
      attachment,
      options,
    );
  }

  return mapExecution(prepared.row, prepared.replayed);
}

export async function processMetaWhatsAppMediaImportWorker(
  db: DbClient,
  actorId: string,
  tenantId: string,
  dependencies: ChannelProviderMediaImportDependencies,
  options: ChannelProviderMediaImportWorkerOptions = {},
) {
  const now = options.now ?? new Date(nowIso());
  const limit = boundedInteger(options.limit, 25, 100);
  const due = await withTenantDbTransaction(db, tenantId, actorId, async (transaction) => {
    await assertWorkerAccess(transaction, actorId, tenantId);
    return listActionableChannelProviderMediaImports(transaction, {
      tenantId,
      dueAt: now.toISOString(),
      limit,
    });
  });
  const summary = emptyWorkerSummary(
    mediaImportRuntimeState(dependencies),
    due.length,
  );
  for (const item of due) {
    const result = await processMetaWhatsAppMediaImport(
      db,
      actorId,
      { tenantId, mediaImportId: item.media_import_id },
      dependencies,
      { ...options, now },
    );
    if (result.idempotentReplay) summary.skipped += 1;
    else {
      summary.processed += 1;
      if (result.status === "succeeded") summary.succeeded += 1;
      else if (result.retryable) summary.retried += 1;
      else summary.failed += 1;
    }
  }
  return summary;
}

/**
 * Composition du worker applicatif. Sur PostgreSQL, l'appelant doit fournir un
 * contexte `app.system_access=true`; la sélection globale reste alors bornée,
 * puis chaque traitement conserve le `tenant_id` de sa réservation.
 */
export async function processMetaWhatsAppMediaImportsSystemWorker(
  db: DbClient,
  dependencies: ChannelProviderMediaImportDependencies | undefined,
  options: ChannelProviderMediaImportWorkerOptions = {},
): Promise<ChannelProviderMediaImportWorkerSummary> {
  const state = mediaImportRuntimeState(dependencies);
  if (state !== "mock" || !dependencies) return emptyWorkerSummary(state);

  await assertSystemContextWhenPostgres(db);
  const now = options.now ?? new Date(nowIso());
  const limit = boundedInteger(options.limit, 25, 100);
  const due = await listActionableChannelProviderMediaImportsForSystem(db, {
    dueAt: now.toISOString(),
    limit,
  });
  const summary = emptyWorkerSummary("mock", due.length);
  for (const item of due) {
    const result = await processMetaWhatsAppMediaImportAs(
      db,
      { actorId: systemActorId, access: "system" },
      { tenantId: item.tenant_id, mediaImportId: item.media_import_id },
      dependencies,
      { ...options, now },
    );
    if (result.idempotentReplay) summary.skipped += 1;
    else {
      summary.processed += 1;
      if (result.status === "succeeded") summary.succeeded += 1;
      else if (result.retryable) summary.retried += 1;
      else summary.failed += 1;
    }
  }
  return summary;
}

type PreparedAttachment = {
  id: string;
  messageId: string;
  kind: "document" | "image" | "audio" | "video" | "file";
  fileName: string;
  mediaType: string;
  sizeBytes: number;
  storageReference: string;
  checksumSha256: string;
};

type FinalOutcome = {
  status: "succeeded" | "failed" | "denied";
  failureClassification: MediaImportFailureClassification | null;
  safeErrorCode: string | null;
  retryable: boolean;
};

async function finalizeIoOutcome(
  db: DbClient,
  identity: MediaImportExecutionIdentity,
  claimed: ChannelProviderMediaImportExecutionRow,
  leaseId: string,
  outcome: FinalOutcome,
  attachment: PreparedAttachment | null,
  options: ChannelProviderMediaImportWorkerOptions,
) {
  const completedAt = options.now ?? new Date(nowIso());
  const retryable = outcome.retryable && claimed.attempts < claimed.max_attempts;
  const baseBackoffMs = boundedInteger(options.baseBackoffMs, defaultBaseBackoffMs, 60_000);
  const nextAttemptAt = retryable
    ? new Date(
        completedAt.getTime() + baseBackoffMs * 2 ** Math.max(0, claimed.attempts - 1),
      ).toISOString()
    : completedAt.toISOString();
  const finalOutcome =
    outcome.retryable && !retryable
      ? failedOutcome("permanent", "media_import_max_attempts_exceeded", false)
      : { ...outcome, retryable };

  return withTenantDbTransaction(
    db,
    claimed.tenant_id,
    identity.actorId,
    async (transaction) => {
    if (identity.access === "tenant_member") {
      await assertWorkerAccess(transaction, identity.actorId, claimed.tenant_id);
    }
    if (attachment) {
      await insertConversationAttachment(transaction, {
        ...attachment,
        tenantId: claimed.tenant_id,
        createdAt: completedAt.toISOString(),
      });
    }
    const finalized = await finalizeChannelProviderMediaImportExecution(transaction, {
      tenantId: claimed.tenant_id,
      mediaImportId: claimed.media_import_id,
      leaseId,
      ...finalOutcome,
      nextAttemptAt,
      attachmentId: attachment?.id ?? null,
      updatedAt: completedAt.toISOString(),
    });
    if (!finalized) {
      throw workerError("channel_provider_media_import_not_actionable");
    }
    await auditExecution(transaction, identity.actorId, finalized, "completed");
    return mapExecution(finalized, false);
    },
  );
}

async function finalizeWithoutIo(
  db: DbClient,
  actorId: string,
  claimed: ChannelProviderMediaImportExecutionRow,
  leaseId: string,
  updatedAt: string,
  classification: "validation" | "policy" | "not_configured",
  safeErrorCode: string,
) {
  const outcome =
    classification === "validation"
      ? failedOutcome(classification, safeErrorCode, false)
      : deniedOutcome(classification, safeErrorCode);
  const finalized = await finalizeChannelProviderMediaImportExecution(db, {
    tenantId: claimed.tenant_id,
    mediaImportId: claimed.media_import_id,
    leaseId,
    ...outcome,
    nextAttemptAt: updatedAt,
    attachmentId: null,
    updatedAt,
  });
  if (!finalized) throw workerError("channel_provider_media_import_not_actionable");
  await auditExecution(db, actorId, finalized, "completed");
  return { row: finalized, replayed: false as const };
}

async function auditExecution(
  db: DbClient,
  actorId: string,
  execution: ChannelProviderMediaImportExecutionRow,
  phase: "reserved" | "attempted" | "completed",
) {
  const action =
    phase === "reserved"
      ? "channel.provider_media_import_execution_reserved"
      : phase === "attempted"
        ? "channel.provider_media_import_attempted"
        : execution.status === "succeeded"
          ? "channel.provider_media_import_succeeded"
          : execution.retryable
            ? "channel.provider_media_import_retry_scheduled"
            : execution.status === "denied"
              ? "channel.provider_media_import_denied"
              : "channel.provider_media_import_failed";
  await recordAuditLog(db, {
    tenantId: execution.tenant_id,
    actorId,
    action,
    targetType: "channel_provider_media_import_execution",
    targetId: execution.id,
    metadata: {
      provider: execution.provider,
      providerMode: execution.provider_mode,
      storageMode: execution.storage_mode,
      status: execution.status,
      classification: execution.failure_classification,
      retryable: execution.retryable === null ? null : Boolean(execution.retryable),
      attempt: execution.attempts,
      maxAttempts: execution.max_attempts,
      contentStoredInAudit: false,
      providerReferenceStoredInAudit: false,
      storageReferenceStoredInAudit: false,
    },
  });
}

async function assertWorkerAccess(db: DbClient, actorId: string, tenantId: string) {
  await assertTenantAccess(db, actorId, tenantId, workerRoles);
}

function mediaImportRuntimeState(
  dependencies: ChannelProviderMediaImportDependencies | undefined,
): MediaImportRuntimeMode {
  if (!dependencies) return "not_configured";
  if (
    dependencies.provider.state === "disabled" ||
    dependencies.storage.state === "disabled"
  ) {
    return "disabled";
  }
  if (
    dependencies.provider.state === "mock" &&
    dependencies.storage.state === "mock" &&
    dependencies.cipher
  ) {
    return "mock";
  }
  return "not_configured";
}

function emptyWorkerSummary(
  state: MediaImportRuntimeMode,
  selected = 0,
): ChannelProviderMediaImportWorkerSummary {
  return {
    state,
    selected,
    processed: 0,
    succeeded: 0,
    retried: 0,
    failed: 0,
    skipped: 0,
  };
}

async function assertSystemContextWhenPostgres(db: DbClient) {
  const runtime = db as DbClient & { __runtime?: "postgres" };
  if (runtime.__runtime !== "postgres") return;
  const result = await db.query<{ allowed: boolean | string | number }>(
    "select app_is_system() as allowed",
  );
  const allowed = result.rows[0]?.allowed;
  if (!(allowed === true || allowed === "true" || allowed === 1)) {
    throw new Error("Le worker média exige un contexte système PostgreSQL.");
  }
}

async function evaluatePolicySafely(
  evaluator: MediaImportPolicyEvaluator,
  input: Parameters<MediaImportPolicyEvaluator>[0],
) {
  try {
    const result = await evaluator(input);
    if (result.allowed) return { allowed: true as const };
    return { allowed: false as const, code: safeErrorCodeSchema.parse(result.code) };
  } catch {
    return { allowed: false as const, code: "policy_evaluation_failed" };
  }
}

async function fetchSafely(
  adapter: MetaWhatsAppMediaFetchAdapter,
  input: Parameters<MetaWhatsAppMediaFetchAdapter["fetch"]>[0],
) {
  try {
    if (adapter.state !== "mock") return providerUnavailable(adapter.state);
    const result = await adapter.fetch(input);
    if (result.status === "succeeded") {
      if (!(result.bytes instanceof Uint8Array)) {
        throw new Error("Réponse média mock invalide.");
      }
      return {
        status: "succeeded" as const,
        bytes: result.bytes,
        mediaType: mediaTypeSchema.parse(result.mediaType).toLowerCase(),
      };
    }
    return parseFailure(result);
  } catch {
    return temporaryFailure("media_provider_unavailable");
  }
}

async function storeSafely(
  adapter: ImmutableMediaStorageAdapter,
  input: Parameters<ImmutableMediaStorageAdapter["store"]>[0],
) {
  try {
    if (adapter.state !== "mock") return providerUnavailable(adapter.state);
    const result = await adapter.store(input);
    if (result.status === "succeeded") {
      return {
        status: "succeeded" as const,
        storageReference: storageReferenceSchema.parse(result.storageReference),
      };
    }
    return parseFailure(result);
  } catch {
    return temporaryFailure("media_storage_unavailable");
  }
}

function parseFailure(result: MediaImportFailureResult): MediaImportFailureResult {
  return {
    status: "failed",
    classification:
      result.classification === "temporary" ? "temporary" : "permanent",
    safeErrorCode: safeErrorCodeSchema.parse(result.safeErrorCode),
    retryable: result.classification === "temporary" && result.retryable === true,
  };
}

function providerUnavailable(state: Exclude<MediaImportRuntimeMode, "mock">) {
  return {
    status: "failed" as const,
    classification: "permanent" as const,
    safeErrorCode:
      state === "disabled" ? "media_import_disabled" : "media_import_not_configured",
    retryable: false,
  };
}

function temporaryFailure(code: string): MediaImportFailureResult {
  return { status: "failed", classification: "temporary", safeErrorCode: code, retryable: true };
}

function validateFetchedMedia(
  fetched: { bytes: Uint8Array; mediaType: string },
  reference: ChannelProviderMediaReference,
  maxBytes: number,
):
  | { ok: true; mediaType: string; checksumSha256: string }
  | { ok: false; code: string } {
  if (fetched.bytes.byteLength < 1) return { ok: false, code: "media_empty" };
  if (fetched.bytes.byteLength > maxBytes) return { ok: false, code: "media_too_large" };
  const declaredMediaType = reference.declaredMediaType.toLowerCase();
  if (fetched.mediaType !== declaredMediaType) {
    return { ok: false, code: "media_type_mismatch" };
  }
  if (!isMediaTypeAllowedForKind(reference.mediaKind, declaredMediaType)) {
    return { ok: false, code: "media_kind_mismatch" };
  }
  if (!hasExpectedBinarySignature(fetched.bytes, declaredMediaType)) {
    return { ok: false, code: "media_binary_type_invalid" };
  }
  const checksumSha256 = createHash("sha256").update(fetched.bytes).digest("hex");
  if (checksumSha256 !== reference.declaredChecksumSha256.toLowerCase()) {
    return { ok: false, code: "media_checksum_mismatch" };
  }
  return { ok: true, mediaType: declaredMediaType, checksumSha256 };
}

function isMediaTypeAllowedForKind(
  kind: ChannelProviderMediaReference["mediaKind"],
  mediaType: string,
) {
  const allowed: Record<ChannelProviderMediaReference["mediaKind"], readonly string[]> = {
    image: ["image/jpeg", "image/png"],
    sticker: ["image/webp"],
    audio: ["audio/aac", "audio/mp4", "audio/mpeg", "audio/amr", "audio/ogg"],
    video: ["video/mp4", "video/3gpp"],
    document: [
      "text/plain",
      "application/pdf",
      "application/msword",
      "application/vnd.ms-excel",
      "application/vnd.ms-powerpoint",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ],
  };
  return allowed[kind].includes(mediaType);
}

function hasExpectedBinarySignature(bytes: Uint8Array, mediaType: string) {
  const starts = (...prefix: number[]) =>
    bytes.byteLength >= prefix.length && prefix.every((value, index) => bytes[index] === value);
  const ascii = (offset: number, value: string) =>
    bytes.byteLength >= offset + value.length &&
    value.split("").every((character, index) => bytes[offset + index] === character.charCodeAt(0));
  switch (mediaType) {
    case "image/jpeg":
      return starts(0xff, 0xd8, 0xff);
    case "image/png":
      return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case "image/webp":
      return ascii(0, "RIFF") && ascii(8, "WEBP");
    case "application/pdf":
      return ascii(0, "%PDF-");
    case "text/plain":
      try {
        return !bytes.includes(0) && Boolean(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
      } catch {
        return false;
      }
    case "application/msword":
    case "application/vnd.ms-excel":
    case "application/vnd.ms-powerpoint":
      return starts(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1);
    case "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    case "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    case "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
      return starts(0x50, 0x4b, 0x03, 0x04);
    case "audio/ogg":
      return ascii(0, "OggS");
    case "audio/mpeg":
      return ascii(0, "ID3") || (bytes[0] === 0xff && (bytes[1] ?? 0) >= 0xe0);
    case "audio/aac":
      return bytes[0] === 0xff && (((bytes[1] ?? 0) & 0xf6) === 0xf0);
    case "audio/amr":
      return ascii(0, "#!AMR\n");
    case "audio/mp4":
    case "video/mp4":
    case "video/3gpp":
      return ascii(4, "ftyp");
    default:
      return false;
  }
}

function safeFileName(reference: ChannelProviderMediaReference) {
  if (reference.originalFileName) return reference.originalFileName;
  const extensions: Record<ChannelProviderMediaReference["mediaKind"], string> = {
    image: "image",
    audio: "audio",
    document: "document",
    video: "video",
    sticker: "webp",
  };
  return `media-whatsapp.${extensions[reference.mediaKind]}`;
}

function attachmentKind(mediaKind: ChannelProviderMediaReference["mediaKind"]) {
  return mediaKind === "sticker" ? ("image" as const) : mediaKind;
}

function deterministicAttachmentId(executionId: string) {
  return `conversation_attachment_${hashToken(executionId).slice(0, 40)}`;
}

function failureOutcome(result: MediaImportFailureResult): FinalOutcome {
  return failedOutcome(result.classification, result.safeErrorCode, result.retryable);
}

function failedOutcome(
  classification: "temporary" | "permanent" | "validation",
  safeErrorCode: string,
  retryable: boolean,
): FinalOutcome {
  return {
    status: "failed",
    failureClassification: classification,
    safeErrorCode,
    retryable,
  };
}

function deniedOutcome(
  classification: "policy" | "not_configured",
  safeErrorCode: string,
): FinalOutcome {
  return {
    status: "denied",
    failureClassification: classification,
    safeErrorCode,
    retryable: false,
  };
}

function succeededOutcome(): FinalOutcome {
  return {
    status: "succeeded",
    failureClassification: null,
    safeErrorCode: null,
    retryable: false,
  };
}

function mapExecution(row: ChannelProviderMediaImportExecutionRow, replayed: boolean) {
  return {
    executionId: row.id,
    mediaImportId: row.media_import_id,
    status: row.status,
    classification: row.failure_classification,
    safeErrorCode: row.safe_error_code,
    retryable: row.retryable === null ? null : Boolean(row.retryable),
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    attachmentId: row.attachment_id,
    providerMode: row.provider_mode,
    storageMode: row.storage_mode,
    idempotentReplay: replayed,
  };
}

function boundedInteger(value: number | undefined, fallback: number, maximum: number) {
  return Number.isInteger(value) && value !== undefined && value > 0 && value <= maximum
    ? value
    : fallback;
}

function workerError(code: ChannelProviderMediaImportWorkerError["code"]) {
  return new ChannelProviderMediaImportWorkerError(code);
}
