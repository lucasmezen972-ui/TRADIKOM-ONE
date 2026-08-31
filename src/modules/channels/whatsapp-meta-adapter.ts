import { createHash } from "node:crypto";
import { z } from "zod";
import {
  verifyMetaWhatsAppWebhook,
  type MetaWebhookVerificationResult,
} from "@/modules/channels/whatsapp-meta-webhook";

const receivedAtSchema = z.string().datetime({ offset: true });
const numericReferenceSchema = z.string().regex(/^\d{1,64}$/);
const messageIdSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^wamid\.[-A-Za-z0-9._:+/=]+$/);
const senderSchema = z.string().regex(/^\d{8,15}$/);
const displayPhoneNumberSchema = z.string().regex(/^\+?\d{8,15}$/);
const messageTimestampSchema = z.string().regex(/^\d{1,20}$/);
const textSchema = z.string().trim().min(1).max(4_096);
const contactSchema = z
  .object({
    profile: z
      .object({ name: z.string().trim().min(1).max(256) })
      .strict(),
    wa_id: senderSchema,
  })
  .strict();

export type PreparedMetaWhatsAppInboundMessage = {
  provider: "whatsapp_meta";
  adapterKey: "whatsapp-meta";
  externalMessageId: string;
  safeAccountReference: string;
  senderAddress: string;
  recipientAddress: string;
  text: string;
  idempotencyKey: string;
  correlationId: string;
  receivedAt: string;
};

export type MetaWhatsAppInboundPreparationResult =
  | { ok: true; message: PreparedMetaWhatsAppInboundMessage }
  | Extract<MetaWebhookVerificationResult, { ok: false }>
  | { ok: false; code: "whatsapp_payload_invalid" };

/** Normalise un seul événement texte Meta, exclusivement après signature. */
export function prepareVerifiedMetaWhatsAppInboundMessage(
  input: unknown,
  appSecret: string | undefined,
  receivedAt: string,
): MetaWhatsAppInboundPreparationResult {
  if (!receivedAtSchema.safeParse(receivedAt).success) {
    return { ok: false, code: "whatsapp_payload_invalid" };
  }
  const verified = verifyMetaWhatsAppWebhook(input, appSecret);
  if (!verified.ok) return verified;

  const rawBody = readRawBody(input);
  if (!rawBody) return { ok: false, code: "whatsapp_payload_invalid" };
  try {
    return normalizeMetaPayload(JSON.parse(rawBody), receivedAt);
  } catch {
    return { ok: false, code: "whatsapp_payload_invalid" };
  }
}

function readRawBody(input: unknown) {
  if (!input || typeof input !== "object") return null;
  const value = (input as { rawBody?: unknown }).rawBody;
  return typeof value === "string" ? value : null;
}

function normalizeMetaPayload(
  value: unknown,
  receivedAt: string,
): MetaWhatsAppInboundPreparationResult {
  const root = z
    .object({
      object: z.literal("whatsapp_business_account"),
      entry: z.array(z.unknown()).length(1),
    })
    .strict()
    .safeParse(value);
  if (!root.success) return { ok: false, code: "whatsapp_payload_invalid" };

  const entry = z
    .object({
      id: numericReferenceSchema,
      changes: z.array(z.unknown()).length(1),
    })
    .strict()
    .safeParse(root.data.entry[0]);
  if (!entry.success) return { ok: false, code: "whatsapp_payload_invalid" };

  const change = z
    .object({
      field: z.literal("messages"),
      value: z
        .object({
          messaging_product: z.literal("whatsapp").optional(),
          metadata: z
            .object({
              display_phone_number: displayPhoneNumberSchema.optional(),
              phone_number_id: numericReferenceSchema,
            })
            .strict(),
          contacts: z.array(contactSchema).min(1).max(10).optional(),
          messages: z
            .array(
              z
                .object({
                  id: messageIdSchema,
                  from: senderSchema,
                  timestamp: messageTimestampSchema.optional(),
                  type: z.literal("text"),
                  text: z.object({ body: textSchema }).strict(),
                })
                .strict(),
            )
            .length(1),
        })
        .strict(),
    })
    .strict()
    .safeParse(entry.data.changes[0]);
  if (!change.success) return { ok: false, code: "whatsapp_payload_invalid" };

  const message = change.data.value.messages[0];
  const messageFingerprint = createHash("sha256")
    .update(message.id, "utf8")
    .digest("hex");
  return {
    ok: true,
    message: {
      provider: "whatsapp_meta",
      adapterKey: "whatsapp-meta",
      externalMessageId: message.id,
      safeAccountReference: entry.data.id,
      senderAddress: `whatsapp:+${message.from}`,
      recipientAddress: `whatsapp:+${change.data.value.metadata.phone_number_id}`,
      text: message.text.body,
      idempotencyKey: `ingress:whatsapp_meta:${messageFingerprint}`,
      correlationId: `meta_${messageFingerprint}`,
      receivedAt,
    },
  };
}
