import { z } from "zod";
import {
  normalizeVerifiedMetaWhatsAppInboundPayload,
  type PreparedMetaWhatsAppInboundMessage,
} from "@/modules/channels/whatsapp-meta-adapter";
import {
  normalizeVerifiedMetaWhatsAppDeliveryStatusPayload,
  type VerifiedMetaWhatsAppDeliveryStatus,
} from "@/modules/channels/whatsapp-meta-delivery-status";
import {
  verifyMetaWhatsAppWebhook,
  type MetaWebhookVerificationResult,
} from "@/modules/channels/whatsapp-meta-webhook";

const numericReferenceSchema = z.string().regex(/^\d{1,64}$/);
const genericEnvelopeSchema = z
  .object({
    object: z.literal("whatsapp_business_account"),
    entry: z
      .array(
        z
          .object({
            id: numericReferenceSchema,
            changes: z
              .array(
                z
                  .object({
                    field: z.literal("messages"),
                    value: z.record(z.string(), z.unknown()),
                  })
                  .strict(),
              )
              .min(1)
              .max(10),
          })
          .strict(),
      )
      .min(1)
      .max(10),
  })
  .strict();

const maxBatchItems = 100;

export type PreparedMetaWhatsAppWebhookBatch = {
  messages: PreparedMetaWhatsAppInboundMessage[];
  statuses: VerifiedMetaWhatsAppDeliveryStatus[];
};

export type MetaWhatsAppWebhookBatchPreparationResult =
  | ({ ok: true } & PreparedMetaWhatsAppWebhookBatch)
  | Extract<MetaWebhookVerificationResult, { ok: false }>
  | { ok: false; code: "whatsapp_payload_invalid" };

/**
 * Vérifie une seule fois l'enveloppe brute, puis distribue chaque changement
 * strictement validé vers le normaliseur messages ou statuts.
 */
export function prepareVerifiedMetaWhatsAppWebhookBatch(
  input: unknown,
  appSecret: string | undefined,
  receivedAt: string,
): MetaWhatsAppWebhookBatchPreparationResult {
  const verified = verifyMetaWhatsAppWebhook(input, appSecret);
  if (!verified.ok) return verified;

  const rawBody = readRawBody(input);
  if (!rawBody) return { ok: false, code: "whatsapp_payload_invalid" };

  let value: unknown;
  try {
    value = JSON.parse(rawBody);
  } catch {
    return { ok: false, code: "whatsapp_payload_invalid" };
  }

  const envelope = genericEnvelopeSchema.safeParse(value);
  if (!envelope.success) {
    return { ok: false, code: "whatsapp_payload_invalid" };
  }

  const messages: PreparedMetaWhatsAppInboundMessage[] = [];
  const statuses: VerifiedMetaWhatsAppDeliveryStatus[] = [];
  for (const entry of envelope.data.entry) {
    for (const change of entry.changes) {
      const hasMessages = Object.hasOwn(change.value, "messages");
      const hasStatuses = Object.hasOwn(change.value, "statuses");
      if (hasMessages === hasStatuses) {
        return { ok: false, code: "whatsapp_payload_invalid" };
      }

      const fragment = {
        object: "whatsapp_business_account" as const,
        entry: [{ id: entry.id, changes: [change] }],
      };
      if (hasMessages) {
        const normalized = normalizeVerifiedMetaWhatsAppInboundPayload(
          fragment,
          receivedAt,
        );
        if (!normalized.ok) return normalized;
        messages.push(...normalized.messages);
      } else {
        const normalized = normalizeVerifiedMetaWhatsAppDeliveryStatusPayload(
          fragment,
        );
        if (!normalized.ok) return normalized;
        statuses.push(...normalized.events);
      }

      if (messages.length + statuses.length > maxBatchItems) {
        return { ok: false, code: "whatsapp_payload_invalid" };
      }
    }
  }

  return { ok: true, messages, statuses };
}

function readRawBody(input: unknown) {
  if (!input || typeof input !== "object") return null;
  const value = (input as { rawBody?: unknown }).rawBody;
  return typeof value === "string" ? value : null;
}
