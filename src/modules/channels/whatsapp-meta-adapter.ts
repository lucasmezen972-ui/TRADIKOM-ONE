import { z } from "zod";
import {
  verifyMetaWhatsAppWebhook,
  type MetaWebhookVerificationResult,
} from "@/modules/channels/whatsapp-meta-webhook";

const receivedAtSchema = z.string().datetime({ offset: true });
const numericReferenceSchema = z.string().regex(/^\d{1,64}$/);
const messageIdSchema = z.string().regex(/^[A-Za-z0-9._-]{1,160}$/);
const senderSchema = z.string().regex(/^\d{8,15}$/);
const textSchema = z.string().trim().min(1).max(4_096);

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
          metadata: z.object({ phone_number_id: numericReferenceSchema }).strict(),
          messages: z
            .array(
              z
                .object({
                  id: messageIdSchema,
                  from: senderSchema,
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
      idempotencyKey: `ingress:whatsapp_meta:${message.id}`,
      correlationId: `meta_${message.id}`,
      receivedAt,
    },
  };
}
