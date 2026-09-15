import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { DbClient } from "@/lib/db";
import { id } from "@/lib/security";
import { recordAuditLog } from "@/modules/audit";
import type {
  ChannelProviderMediaReference,
  ChannelProviderMediaReferenceCipher,
  ChannelProviderMediaReferenceContext,
} from "@/modules/channels/channel-provider-media-reference-crypto";
import {
  findChannelProviderMediaImportReservation,
  insertChannelProviderMediaImportReservation,
  type ChannelProviderMediaImportStatus,
} from "@/modules/channels/channel-provider-media-imports-repository";

const fingerprintSecretSchema = z.string().min(32).max(4_096);
const encryptedReferenceSchema = z.string().min(64).max(16_384);
const keyVersionSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

export class ChannelProviderMediaImportError extends Error {
  constructor(
    readonly code: "channel_provider_media_import_idempotency_conflict",
  ) {
    super("La réservation média fournisseur entre en conflit avec son rejeu.");
    this.name = "ChannelProviderMediaImportError";
  }
}

export async function reserveMetaWhatsAppMediaImport(
  db: DbClient,
  input: {
    tenantId: string;
    endpointId: string;
    messageId: string;
    reference: ChannelProviderMediaReference;
    fingerprintSecret: string | undefined;
    cipher?: ChannelProviderMediaReferenceCipher;
    occurredAt: string;
  },
) {
  const context = {
    tenantId: input.tenantId,
    endpointId: input.endpointId,
    messageId: input.messageId,
    provider: "whatsapp_meta" as const,
  } satisfies ChannelProviderMediaReferenceContext;
  const requestFingerprint = fingerprintReference(
    input.reference,
    context,
    input.fingerprintSecret,
  );
  const protection = protectReference(input.reference, context, input.cipher);
  const candidate = {
    id: id("channel_provider_media_import"),
    tenant_id: input.tenantId,
    provider: "whatsapp_meta" as const,
    endpoint_id: input.endpointId,
    message_id: input.messageId,
    media_kind: input.reference.mediaKind,
    reservation_status: protection.status,
    encrypted_provider_reference: protection.encryptedReference,
    key_version: protection.keyVersion,
    request_fingerprint: requestFingerprint,
    safe_error_code: protection.safeErrorCode,
    created_at: input.occurredAt,
    updated_at: input.occurredAt,
  };
  const inserted = await insertChannelProviderMediaImportReservation(
    db,
    candidate,
  );
  if (!inserted) {
    const replay = await findChannelProviderMediaImportReservation(db, {
      tenantId: input.tenantId,
      provider: "whatsapp_meta",
      messageId: input.messageId,
    });
    if (!replay || !sameFingerprint(replay.request_fingerprint, requestFingerprint)) {
      throw new ChannelProviderMediaImportError(
        "channel_provider_media_import_idempotency_conflict",
      );
    }
    return safeResult(replay, true);
  }

  await recordAuditLog(db, {
    tenantId: input.tenantId,
    actorId: "system_whatsapp_meta",
    action: "channel.provider_media_import_reserved",
    targetType: "channel_provider_media_import",
    targetId: inserted.id,
    metadata: {
      provider: inserted.provider,
      mediaKind: inserted.media_kind,
      reservationStatus: inserted.reservation_status,
      contentStoredInAudit: false,
      providerReferenceStoredInAudit: false,
    },
  });
  return safeResult(inserted, false);
}

function protectReference(
  reference: ChannelProviderMediaReference,
  context: ChannelProviderMediaReferenceContext,
  cipher: ChannelProviderMediaReferenceCipher | undefined,
): {
  status: ChannelProviderMediaImportStatus;
  encryptedReference: string | null;
  keyVersion: string | null;
  safeErrorCode:
    | "media_reference_vault_not_configured"
    | "media_reference_encryption_failed"
    | null;
} {
  if (!cipher) {
    return {
      status: "not_configured",
      encryptedReference: null,
      keyVersion: null,
      safeErrorCode: "media_reference_vault_not_configured",
    };
  }
  try {
    return {
      status: "pending",
      encryptedReference: encryptedReferenceSchema.parse(
        cipher.encrypt(reference, context),
      ),
      keyVersion: keyVersionSchema.parse(cipher.keyVersion),
      safeErrorCode: null,
    };
  } catch {
    return {
      status: "failed",
      encryptedReference: null,
      keyVersion: null,
      safeErrorCode: "media_reference_encryption_failed",
    };
  }
}

function fingerprintReference(
  reference: ChannelProviderMediaReference,
  context: ChannelProviderMediaReferenceContext,
  fingerprintSecret: string | undefined,
) {
  const secret = fingerprintSecretSchema.parse(fingerprintSecret);
  return createHmac("sha256", secret)
    .update(
      JSON.stringify([
        "tradikom-channel-media-import-v1",
        context.tenantId,
        context.provider,
        context.endpointId,
        context.messageId,
        reference.mediaKind,
        reference.mediaId,
        reference.declaredMediaType,
        reference.declaredChecksumSha256.toLowerCase(),
        reference.originalFileName,
      ]),
    )
    .digest("hex");
}

function sameFingerprint(left: string, right: string) {
  const leftBytes = /^[a-f0-9]{64}$/.test(left)
    ? Buffer.from(left, "hex")
    : Buffer.alloc(0);
  const rightBytes = /^[a-f0-9]{64}$/.test(right)
    ? Buffer.from(right, "hex")
    : Buffer.alloc(0);
  return (
    leftBytes.length === rightBytes.length &&
    leftBytes.length === 32 &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

function safeResult(
  row: {
    id: string;
    reservation_status: ChannelProviderMediaImportStatus;
    safe_error_code: string | null;
  },
  replayed: boolean,
) {
  return {
    reservationId: row.id,
    status: row.reservation_status,
    safeErrorCode: row.safe_error_code,
    replayed,
  };
}
