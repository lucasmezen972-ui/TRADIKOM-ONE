import { z } from "zod";
import {
  verifyMetaWhatsAppWebhook,
  type MetaWebhookVerificationResult,
} from "@/modules/channels/whatsapp-meta-webhook";

const numericReferenceSchema = z.string().regex(/^\d{1,64}$/);
const providerMessageIdSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^wamid\.[-A-Za-z0-9._:+/=]+$/);
const statusTimestampSchema = z.string().regex(/^\d{1,20}$/);
const sourceStatusSchema = z.enum([
  "sent",
  "delivered",
  "read",
  "failed",
  "deleted",
]);
const boundedTextSchema = z.string().trim().min(1).max(512);

const providerErrorSchema = z
  .object({
    code: z.number().int().nonnegative().optional(),
    title: boundedTextSchema.optional(),
    message: boundedTextSchema.optional(),
    error_data: z
      .object({ details: boundedTextSchema.optional() })
      .strict()
      .optional(),
  })
  .strict();

const statusSchema = z
  .object({
    id: providerMessageIdSchema,
    status: sourceStatusSchema,
    timestamp: statusTimestampSchema,
    recipient_id: numericReferenceSchema,
    conversation: z
      .object({
        id: boundedTextSchema,
        origin: z.object({ type: boundedTextSchema }).strict(),
        expiration_timestamp: statusTimestampSchema.optional(),
      })
      .strict()
      .optional(),
    pricing: z
      .object({
        billable: z.boolean(),
        pricing_model: boundedTextSchema,
        category: boundedTextSchema,
        type: boundedTextSchema.optional(),
      })
      .strict()
      .optional(),
    errors: z.array(providerErrorSchema).min(1).max(10).optional(),
    biz_opaque_callback_data: z.string().max(512).optional(),
  })
  .strict();

export type VerifiedMetaWhatsAppDeliveryStatus = {
  safeAccountReference: string;
  phoneNumberId: string;
  providerMessageId: string;
  sourceStatus: z.infer<typeof sourceStatusSchema>;
  status: "accepted" | "delivered" | "failed";
  safeErrorCode: string | null;
};

export type MetaWhatsAppDeliveryStatusPreparationResult =
  | { ok: true; events: VerifiedMetaWhatsAppDeliveryStatus[] }
  | Extract<MetaWebhookVerificationResult, { ok: false }>
  | { ok: false; code: "whatsapp_payload_invalid" };

export type MetaWhatsAppDeliveryStatusNormalizationResult =
  | { ok: true; events: VerifiedMetaWhatsAppDeliveryStatus[] }
  | { ok: false; code: "whatsapp_payload_invalid" };

const maxBatchEvents = 100;

/** Vérifie puis normalise une notification de statut WhatsApp Cloud. */
export function prepareVerifiedMetaWhatsAppDeliveryStatus(
  input: unknown,
  appSecret: string | undefined,
): MetaWhatsAppDeliveryStatusPreparationResult {
  const verified = verifyMetaWhatsAppWebhook(input, appSecret);
  if (!verified.ok) return verified;

  const rawBody = readRawBody(input);
  if (!rawBody) return { ok: false, code: "whatsapp_payload_invalid" };
  try {
    return normalizeVerifiedMetaWhatsAppDeliveryStatusPayload(
      JSON.parse(rawBody),
    );
  } catch {
    return { ok: false, code: "whatsapp_payload_invalid" };
  }
}

/** Normalise un fragment déjà couvert par une vérification HMAC réussie. */
export function normalizeVerifiedMetaWhatsAppDeliveryStatusPayload(
  value: unknown,
): MetaWhatsAppDeliveryStatusNormalizationResult {
  const parsed = z
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
                      value: z
                        .object({
                          messaging_product: z.literal("whatsapp"),
                          metadata: z
                            .object({
                              display_phone_number: z
                                .string()
                                .regex(/^\+?\d{8,15}$/)
                                .optional(),
                              phone_number_id: numericReferenceSchema,
                            })
                            .strict(),
                          statuses: z.array(statusSchema).min(1).max(10),
                        })
                        .strict(),
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
    .strict()
    .safeParse(value);
  if (!parsed.success) {
    return { ok: false, code: "whatsapp_payload_invalid" };
  }

  const events = parsed.data.entry.flatMap((entry) =>
    entry.changes.flatMap((change) =>
      change.value.statuses.map((status) => ({
        safeAccountReference: entry.id,
        phoneNumberId: change.value.metadata.phone_number_id,
        providerMessageId: status.id,
        sourceStatus: status.status,
        status: normalizeStatus(status.status),
        safeErrorCode:
          status.status === "failed" || status.status === "deleted"
            ? "provider_delivery_failed"
            : null,
      })),
    ),
  );
  if (events.length > maxBatchEvents) {
    return { ok: false, code: "whatsapp_payload_invalid" };
  }
  return {
    ok: true,
    events,
  };
}

function normalizeStatus(status: z.infer<typeof sourceStatusSchema>) {
  if (status === "sent") return "accepted" as const;
  if (status === "delivered" || status === "read") {
    return "delivered" as const;
  }
  return "failed" as const;
}

function readRawBody(input: unknown) {
  if (!input || typeof input !== "object") return null;
  const value = (input as { rawBody?: unknown }).rawBody;
  return typeof value === "string" ? value : null;
}
