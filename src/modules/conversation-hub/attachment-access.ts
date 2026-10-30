import { createHash } from "node:crypto";
import { z } from "zod";
import { withTenantDbTransaction } from "@/db/tenant-context";
import type { DbClient } from "@/lib/db";
import { hashToken } from "@/lib/security";
import { recordAuditLog } from "@/modules/audit";
import type { AttachmentAccessTicketCodec } from "@/modules/conversation-hub/attachment-access-ticket";
import { AttachmentAccessTicketError } from "@/modules/conversation-hub/attachment-access-ticket";
import {
  findConversationAttachmentAccessRow,
  type ConversationAttachmentAccessRow,
} from "@/modules/conversation-hub/repository";
import { assertTenantAccess } from "@/modules/tenants";

const maximumAttachmentBytes = 25 * 1024 * 1024;
const defaultTicketTtlSeconds = 60;
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
const storageErrorCodeSchema = z.enum([
  "attachment_storage_failed",
  "attachment_storage_forbidden",
  "attachment_storage_not_found",
  "attachment_storage_throttled",
  "attachment_storage_unavailable",
]);
const accessRequestSchema = z
  .object({
    attachmentId: boundedIdentifierSchema,
    ttlSeconds: z.number().int().min(30).max(300).default(defaultTicketTtlSeconds),
  })
  .strict();
const accessDownloadSchema = z
  .object({
    attachmentId: boundedIdentifierSchema,
    ticket: z.string().min(80).max(3_000).regex(/^[A-Za-z0-9_-]+$/),
  })
  .strict();
const persistedAttachmentSchema = z
  .object({
    id: boundedIdentifierSchema,
    tenant_id: boundedIdentifierSchema,
    message_id: boundedIdentifierSchema,
    kind: z.enum(["document", "image", "audio", "video", "file"]),
    file_name: z.string().trim().min(1).max(255),
    media_type: z
      .string()
      .trim()
      .min(3)
      .max(120)
      .regex(/^[A-Za-z0-9!#$&^_.+-]+\/[A-Za-z0-9!#$&^_.+-]+$/),
    size_bytes: z.number().int().positive().max(maximumAttachmentBytes),
    storage_reference: z
      .string()
      .trim()
      .min(1)
      .max(512)
      .regex(/^[A-Za-z0-9][A-Za-z0-9/_.:-]*$/),
    checksum_sha256: z.string().regex(/^[A-Fa-f0-9]{64}$/),
    thread_id: boundedIdentifierSchema,
    confidentiality_level: z.enum([
      "public",
      "internal",
      "restricted",
      "secret",
    ]),
    visibility_scope: z.enum(["personal", "team", "case", "tenant"]),
    access_grantee_user_id: boundedIdentifierSchema.nullable(),
    access_grant_scope: z.enum(["personal", "team", "case"]).nullable(),
    access_granted_at: z.string().datetime({ offset: true }).nullable(),
  })
  .passthrough()
  .superRefine((attachment, context) => {
    const hasCompleteGrant =
      attachment.access_grantee_user_id !== null &&
      attachment.access_grant_scope !== null &&
      attachment.access_granted_at !== null;
    if (attachment.visibility_scope === "tenant") {
      if (
        attachment.access_grantee_user_id !== null ||
        attachment.access_grant_scope !== null ||
        attachment.access_granted_at !== null
      ) {
        context.addIssue({
          code: "custom",
          message: "Un fil organisation ne doit pas dépendre d'un droit individuel.",
        });
      }
      return;
    }
    if (
      !hasCompleteGrant ||
      attachment.access_grant_scope !== attachment.visibility_scope
    ) {
      context.addIssue({
        code: "custom",
        message: "Le droit du fil ne correspond pas à sa portée.",
      });
    }
  });

export type AttachmentAccessRuntimeMode =
  | "disabled"
  | "not_configured"
  | "mock";

export type AttachmentStorageAccessAdapter =
  | { readonly state: "disabled" | "not_configured" }
  | {
      readonly state: "mock";
      read(input: {
        tenantId: string;
        attachmentId: string;
        storageReference: string;
        idempotencyKey: string;
        maxBytes: number;
      }): Promise<
        | { status: "succeeded"; bytes: Uint8Array }
        | {
            status: "failed";
            classification: "temporary" | "permanent";
            safeErrorCode: string;
          }
      >;
    };

export type AttachmentAccessPolicyEvaluator = (input: {
  tenantId: string;
  userId: string;
  attachmentId: string;
  messageId: string;
  threadId: string;
  confidentialityLevel: ConversationAttachmentAccessRow["confidentiality_level"];
  visibilityScope: ConversationAttachmentAccessRow["visibility_scope"];
  kind: ConversationAttachmentAccessRow["kind"];
  sizeBytes: number;
  operation: "prepare" | "read";
}) =>
  | { allowed: true }
  | { allowed: false; code: string }
  | Promise<{ allowed: true } | { allowed: false; code: string }>;

export type AttachmentAccessDependencies = {
  storage: AttachmentStorageAccessAdapter;
  ticketCodec?: AttachmentAccessTicketCodec;
  evaluatePolicy?: AttachmentAccessPolicyEvaluator;
};

export type AttachmentAccessUnavailable = {
  status: "disabled" | "not_configured";
};

export type AttachmentAccessDenied = {
  status: "denied";
  safeErrorCode: string;
};

export type AttachmentAccessFailed = {
  status: "failed";
  classification: "temporary" | "permanent";
  safeErrorCode: string;
  retryable: boolean;
};

export class ConversationAttachmentAccessError extends Error {
  constructor(
    readonly code:
      | "attachment_access_not_found"
      | "attachment_access_metadata_invalid"
      | "attachment_access_ticket_invalid"
      | "attachment_access_ticket_expired",
  ) {
    super("Cette pièce jointe n'est pas disponible.");
    this.name = "ConversationAttachmentAccessError";
  }
}

export function createUnavailableAttachmentAccessDependencies(
  state: "disabled" | "not_configured" = "not_configured",
): AttachmentAccessDependencies {
  return { storage: { state } };
}

export function getAttachmentAccessRuntimeMode(
  dependencies: AttachmentAccessDependencies,
): AttachmentAccessRuntimeMode {
  if (dependencies.storage.state === "disabled") return "disabled";
  if (
    dependencies.storage.state === "not_configured" ||
    !dependencies.ticketCodec ||
    !dependencies.evaluatePolicy
  ) {
    return "not_configured";
  }
  return "mock";
}

export async function prepareConversationAttachmentAccess(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: { attachmentId: string; ttlSeconds?: number },
  dependencies: AttachmentAccessDependencies,
  options: { now?: Date } = {},
) {
  const parsed = accessRequestSchema.parse(input);
  const now = validNow(options.now);
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId);
    const attachment = await requireAttachment(
      transaction,
      tenantId,
      userId,
      parsed.attachmentId,
    );
    const runtimeMode = getAttachmentAccessRuntimeMode(dependencies);
    if (runtimeMode !== "mock") return { status: runtimeMode } as const;

    const policy = await evaluatePolicy(
      dependencies.evaluatePolicy!,
      attachment,
      userId,
      "prepare",
    );
    if (!policy.allowed) {
      await recordAccessAudit(transaction, {
        tenantId,
        userId,
        attachmentId: attachment.id,
        action: "conversation.attachment_access_denied",
        outcome: "denied",
        safeErrorCode: policy.code,
      });
      return { status: "denied", safeErrorCode: policy.code } as const;
    }

    let issued: { ticket: string; expiresAt: string };
    try {
      issued = dependencies.ticketCodec!.issue({
        context: { tenantId, userId, attachmentId: attachment.id },
        now,
        ttlSeconds: parsed.ttlSeconds,
      });
    } catch {
      throw new ConversationAttachmentAccessError(
        "attachment_access_ticket_invalid",
      );
    }
    await recordAccessAudit(transaction, {
      tenantId,
      userId,
      attachmentId: attachment.id,
      action: "conversation.attachment_access_prepared",
      outcome: "ready",
      expiresAt: issued.expiresAt,
    });
    return {
      status: "ready" as const,
      storageMode: "mock" as const,
      ticket: issued.ticket,
      expiresAt: issued.expiresAt,
    };
  });
}

export async function readConversationAttachment(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: { attachmentId: string; ticket: string },
  dependencies: AttachmentAccessDependencies,
  options: { now?: Date } = {},
) {
  const parsed = accessDownloadSchema.parse(input);
  const now = validNow(options.now);
  const prepared = await withTenantDbTransaction(
    db,
    tenantId,
    userId,
    async (transaction) => {
      await assertTenantAccess(transaction, userId, tenantId);
      const attachment = await requireAttachment(
        transaction,
        tenantId,
        userId,
        parsed.attachmentId,
      );
      const runtimeMode = getAttachmentAccessRuntimeMode(dependencies);
      if (runtimeMode !== "mock") {
        return { available: false as const, result: { status: runtimeMode } };
      }
      const policy = await evaluatePolicy(
        dependencies.evaluatePolicy!,
        attachment,
        userId,
        "read",
      );
      if (!policy.allowed) {
        await recordAccessAudit(transaction, {
          tenantId,
          userId,
          attachmentId: attachment.id,
          action: "conversation.attachment_access_denied",
          outcome: "denied",
          safeErrorCode: policy.code,
        });
        return {
          available: false as const,
          result: { status: "denied" as const, safeErrorCode: policy.code },
        };
      }
      try {
        dependencies.ticketCodec!.verify({
          ticket: parsed.ticket,
          context: { tenantId, userId, attachmentId: attachment.id },
          now,
        });
      } catch (error) {
        const code = ticketErrorCode(error);
        await recordAccessAudit(transaction, {
          tenantId,
          userId,
          attachmentId: attachment.id,
          action: "conversation.attachment_access_failed",
          outcome: "failed",
          safeErrorCode: code,
        });
        throw new ConversationAttachmentAccessError(code);
      }
      return { available: true as const, attachment };
    },
  );
  if (!prepared.available) return prepared.result;

  const idempotencyKey = `attachment-access:${hashToken(parsed.ticket)}`;
  let storageResult: Awaited<
    ReturnType<Extract<AttachmentStorageAccessAdapter, { state: "mock" }>["read"]>
  >;
  try {
    storageResult = await (
      dependencies.storage as Extract<
        AttachmentStorageAccessAdapter,
        { state: "mock" }
      >
    ).read({
      tenantId,
      attachmentId: prepared.attachment.id,
      storageReference: prepared.attachment.storage_reference,
      idempotencyKey,
      maxBytes: maximumAttachmentBytes,
    });
  } catch {
    storageResult = {
      status: "failed",
      classification: "temporary",
      safeErrorCode: "attachment_storage_unavailable",
    };
  }

  if (storageResult.status === "failed") {
    const failure = normalizeStorageFailure(storageResult);
    const metadataIsCurrent = await auditReadFailure(
      db,
      userId,
      tenantId,
      prepared.attachment,
      failure,
    );
    if (!metadataIsCurrent) {
      throw new ConversationAttachmentAccessError(
        "attachment_access_metadata_invalid",
      );
    }
    return failure;
  }

  const integrityFailure = validateDownloadedBytes(
    prepared.attachment,
    storageResult.bytes,
  );
  if (integrityFailure) {
    const metadataIsCurrent = await auditReadFailure(
      db,
      userId,
      tenantId,
      prepared.attachment,
      integrityFailure,
    );
    if (!metadataIsCurrent) {
      throw new ConversationAttachmentAccessError(
        "attachment_access_metadata_invalid",
      );
    }
    return integrityFailure;
  }

  const metadataIsCurrent = await withTenantDbTransaction(
    db,
    tenantId,
    userId,
    async (transaction) => {
      await assertTenantAccess(transaction, userId, tenantId);
      const current = await findAuthorizedAttachment(
        transaction,
        tenantId,
        userId,
        prepared.attachment.id,
      );
      if (!current || !sameStoredObject(prepared.attachment, current)) {
        await recordAccessAudit(transaction, {
          tenantId,
          userId,
          attachmentId: prepared.attachment.id,
          action: "conversation.attachment_access_failed",
          outcome: "failed",
          safeErrorCode: "attachment_access_metadata_invalid",
        });
        return false;
      }
      await recordAccessAudit(transaction, {
        tenantId,
        userId,
        attachmentId: current.id,
        action: "conversation.attachment_access_served",
        outcome: "succeeded",
      });
      return true;
    },
  );
  if (!metadataIsCurrent) {
    throw new ConversationAttachmentAccessError(
      "attachment_access_metadata_invalid",
    );
  }
  return {
    status: "succeeded" as const,
    storageMode: "mock" as const,
    content: Buffer.from(storageResult.bytes),
    contentType: prepared.attachment.media_type,
    fileName: safeDownloadFileName(prepared.attachment.file_name),
  };
}

async function requireAttachment(
  db: DbClient,
  tenantId: string,
  userId: string,
  attachmentId: string,
) {
  const row = await findAuthorizedAttachment(
    db,
    tenantId,
    userId,
    attachmentId,
  );
  if (!row) {
    throw new ConversationAttachmentAccessError("attachment_access_not_found");
  }
  return row;
}

async function findAuthorizedAttachment(
  db: DbClient,
  tenantId: string,
  userId: string,
  attachmentId: string,
) {
  const row = await findConversationAttachmentAccessRow(
    db,
    tenantId,
    userId,
    attachmentId,
  );
  if (!row) return null;
  const parsed = persistedAttachmentSchema.safeParse(row);
  if (!parsed.success) {
    throw new ConversationAttachmentAccessError(
      "attachment_access_metadata_invalid",
    );
  }
  return row;
}

async function evaluatePolicy(
  evaluator: AttachmentAccessPolicyEvaluator,
  attachment: ConversationAttachmentAccessRow,
  userId: string,
  operation: "prepare" | "read",
) {
  try {
    const result = await evaluator({
      tenantId: attachment.tenant_id,
      userId,
      attachmentId: attachment.id,
      messageId: attachment.message_id,
      threadId: attachment.thread_id,
      confidentialityLevel: attachment.confidentiality_level,
      visibilityScope: attachment.visibility_scope,
      kind: attachment.kind,
      sizeBytes: attachment.size_bytes,
      operation,
    });
    if (result.allowed) return result;
    return { allowed: false as const, code: safeErrorCodeSchema.parse(result.code) };
  } catch {
    return {
      allowed: false as const,
      code: "attachment_access_policy_failed",
    };
  }
}

function validateDownloadedBytes(
  attachment: ConversationAttachmentAccessRow,
  bytes: Uint8Array,
): AttachmentAccessFailed | null {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.byteLength > maximumAttachmentBytes ||
    bytes.byteLength !== attachment.size_bytes
  ) {
    return permanentFailure("attachment_access_size_mismatch");
  }
  const checksum = createHash("sha256").update(bytes).digest("hex");
  if (checksum !== attachment.checksum_sha256.toLowerCase()) {
    return permanentFailure("attachment_access_checksum_mismatch");
  }
  return null;
}

function normalizeStorageFailure(input: {
  classification: "temporary" | "permanent";
  safeErrorCode: string;
}): AttachmentAccessFailed {
  let safeErrorCode = "attachment_storage_failed";
  try {
    safeErrorCode = storageErrorCodeSchema.parse(input.safeErrorCode);
  } catch {
    // A provider response never controls the public or audited error vocabulary.
  }
  return {
    status: "failed",
    classification: input.classification,
    safeErrorCode,
    retryable: input.classification === "temporary",
  };
}

function permanentFailure(safeErrorCode: string): AttachmentAccessFailed {
  return {
    status: "failed",
    classification: "permanent",
    safeErrorCode,
    retryable: false,
  };
}

async function auditReadFailure(
  db: DbClient,
  userId: string,
  tenantId: string,
  attachment: ConversationAttachmentAccessRow,
  failure: AttachmentAccessFailed,
) {
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId);
    const current = await findAuthorizedAttachment(
      transaction,
      tenantId,
      userId,
      attachment.id,
    );
    if (!current || !sameStoredObject(attachment, current)) {
      await recordAccessAudit(transaction, {
        tenantId,
        userId,
        attachmentId: attachment.id,
        action: "conversation.attachment_access_failed",
        outcome: "failed",
        safeErrorCode: "attachment_access_metadata_invalid",
      });
      return false;
    }
    await recordAccessAudit(transaction, {
      tenantId,
      userId,
      attachmentId: current.id,
      action: "conversation.attachment_access_failed",
      outcome: "failed",
      safeErrorCode: failure.safeErrorCode,
      failureClassification: failure.classification,
    });
    return true;
  });
}

async function recordAccessAudit(
  db: DbClient,
  input: {
    tenantId: string;
    userId: string;
    attachmentId: string;
    action: string;
    outcome: "ready" | "succeeded" | "denied" | "failed";
    expiresAt?: string;
    safeErrorCode?: string;
    failureClassification?: "temporary" | "permanent";
  },
) {
  await recordAuditLog(db, {
    tenantId: input.tenantId,
    actorId: input.userId,
    action: input.action,
    targetType: "conversation_message_attachment",
    targetId: input.attachmentId,
    metadata: {
      storageMode: "mock",
      outcome: input.outcome,
      ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}),
      ...(input.safeErrorCode ? { safeErrorCode: input.safeErrorCode } : {}),
      ...(input.failureClassification
        ? { failureClassification: input.failureClassification }
        : {}),
      ticketStoredInAudit: false,
      contentStoredInAudit: false,
      fileNameStoredInAudit: false,
      checksumStoredInAudit: false,
      storageReferenceStoredInAudit: false,
    },
  });
}

function sameStoredObject(
  expected: ConversationAttachmentAccessRow,
  current: ConversationAttachmentAccessRow,
) {
  return (
    current.message_id === expected.message_id &&
    current.thread_id === expected.thread_id &&
    current.confidentiality_level === expected.confidentiality_level &&
    current.visibility_scope === expected.visibility_scope &&
    current.access_grantee_user_id === expected.access_grantee_user_id &&
    current.access_grant_scope === expected.access_grant_scope &&
    current.access_granted_at === expected.access_granted_at &&
    current.kind === expected.kind &&
    current.file_name === expected.file_name &&
    current.media_type === expected.media_type &&
    current.size_bytes === expected.size_bytes &&
    current.storage_reference === expected.storage_reference &&
    current.checksum_sha256.toLowerCase() ===
      expected.checksum_sha256.toLowerCase()
  );
}

function safeDownloadFileName(fileName: string) {
  return (
    fileName
      .normalize("NFC")
      .replace(/[\u0000-\u001f\u007f"\\/]/g, "_")
      .slice(0, 255) || "piece-jointe"
  );
}

function validNow(now = new Date()) {
  if (!Number.isFinite(now.getTime())) {
    throw new ConversationAttachmentAccessError(
      "attachment_access_ticket_invalid",
    );
  }
  return now;
}

function ticketErrorCode(error: unknown) {
  if (
    error instanceof AttachmentAccessTicketError &&
    error.code === "attachment_access_ticket_expired"
  ) {
    return "attachment_access_ticket_expired" as const;
  }
  return "attachment_access_ticket_invalid" as const;
}
