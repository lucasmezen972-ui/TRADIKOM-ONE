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
const mediaChecksumSchema = z.string().regex(/^[A-Fa-f0-9]{64}$/);
const mediaCaptionSchema = z.string().trim().min(1).max(4_096);
const mediaFileNameSchema = z.string().trim().min(1).max(255);
const contactSchema = z
  .object({
    profile: z
      .object({ name: z.string().trim().min(1).max(256) })
      .strict(),
    wa_id: senderSchema,
  })
  .strict();

const messageBaseShape = {
  id: messageIdSchema,
  from: senderSchema,
  timestamp: messageTimestampSchema.optional(),
};
const mediaObjectBaseShape = {
  id: numericReferenceSchema,
  sha256: mediaChecksumSchema,
};
const inboundMessageSchema = z.discriminatedUnion("type", [
  z
    .object({
      ...messageBaseShape,
      type: z.literal("text"),
      text: z.object({ body: textSchema }).strict(),
    })
    .strict(),
  z
    .object({
      ...messageBaseShape,
      type: z.literal("image"),
      image: z
        .object({
          ...mediaObjectBaseShape,
          mime_type: z.enum(["image/jpeg", "image/png"]),
          caption: mediaCaptionSchema.optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...messageBaseShape,
      type: z.literal("audio"),
      audio: z
        .object({
          ...mediaObjectBaseShape,
          mime_type: z.enum([
            "audio/aac",
            "audio/mp4",
            "audio/mpeg",
            "audio/amr",
            "audio/ogg",
          ]),
          voice: z.boolean().optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...messageBaseShape,
      type: z.literal("document"),
      document: z
        .object({
          ...mediaObjectBaseShape,
          mime_type: z.enum([
            "text/plain",
            "application/pdf",
            "application/vnd.ms-powerpoint",
            "application/msword",
            "application/vnd.ms-excel",
            "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          ]),
          caption: mediaCaptionSchema.optional(),
          filename: mediaFileNameSchema.optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...messageBaseShape,
      type: z.literal("video"),
      video: z
        .object({
          ...mediaObjectBaseShape,
          mime_type: z.enum(["video/mp4", "video/3gpp"]),
          caption: mediaCaptionSchema.optional(),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...messageBaseShape,
      type: z.literal("sticker"),
      sticker: z
        .object({
          ...mediaObjectBaseShape,
          mime_type: z.literal("image/webp"),
          animated: z.boolean().optional(),
        })
        .strict(),
    })
    .strict(),
]);

export type MetaWhatsAppInboundMediaKind =
  | "image"
  | "audio"
  | "document"
  | "video"
  | "sticker";

export type PreparedMetaWhatsAppInboundMessage = {
  provider: "whatsapp_meta";
  adapterKey: "whatsapp-meta";
  externalMessageId: string;
  safeAccountReference: string;
  senderAddress: string;
  recipientAddress: string;
  text: string | null;
  mediaKind: MetaWhatsAppInboundMediaKind | null;
  idempotencyKey: string;
  correlationId: string;
  receivedAt: string;
};

export type MetaWhatsAppInboundPreparationResult =
  | { ok: true; messages: PreparedMetaWhatsAppInboundMessage[] }
  | Extract<MetaWebhookVerificationResult, { ok: false }>
  | { ok: false; code: "whatsapp_payload_invalid" };

export type MetaWhatsAppInboundNormalizationResult =
  | { ok: true; messages: PreparedMetaWhatsAppInboundMessage[] }
  | { ok: false; code: "whatsapp_payload_invalid" };

const maxBatchMessages = 100;

/** Normalise un lot borné d'événements Meta, exclusivement après signature. */
export function prepareVerifiedMetaWhatsAppInboundMessages(
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
    return normalizeVerifiedMetaWhatsAppInboundPayload(
      JSON.parse(rawBody),
      receivedAt,
    );
  } catch {
    return { ok: false, code: "whatsapp_payload_invalid" };
  }
}

function readRawBody(input: unknown) {
  if (!input || typeof input !== "object") return null;
  const value = (input as { rawBody?: unknown }).rawBody;
  return typeof value === "string" ? value : null;
}

/** Normalise un fragment déjà couvert par une vérification HMAC réussie. */
export function normalizeVerifiedMetaWhatsAppInboundPayload(
  value: unknown,
  receivedAt: string,
): MetaWhatsAppInboundNormalizationResult {
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
                          messaging_product: z.literal("whatsapp").optional(),
                          metadata: z
                            .object({
                              display_phone_number:
                                displayPhoneNumberSchema.optional(),
                              phone_number_id: numericReferenceSchema,
                            })
                            .strict(),
                          contacts: z
                            .array(contactSchema)
                            .min(1)
                            .max(10)
                            .optional(),
                          messages: z
                            .array(inboundMessageSchema)
                            .min(1)
                            .max(10),
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
  if (!parsed.success) return { ok: false, code: "whatsapp_payload_invalid" };

  const messages = parsed.data.entry.flatMap((entry) =>
    entry.changes.flatMap((change) =>
      change.value.messages.map((message) => {
        const messageFingerprint = createHash("sha256")
          .update(message.id, "utf8")
          .digest("hex");
        const content = normalizeInboundContent(message);
        return {
          provider: "whatsapp_meta" as const,
          adapterKey: "whatsapp-meta" as const,
          externalMessageId: message.id,
          safeAccountReference: entry.id,
          senderAddress: `whatsapp:+${message.from}`,
          recipientAddress: `whatsapp:+${change.value.metadata.phone_number_id}`,
          text: content.text,
          mediaKind: content.mediaKind,
          idempotencyKey: `ingress:whatsapp_meta:${messageFingerprint}`,
          correlationId: `meta_${messageFingerprint}`,
          receivedAt,
        };
      }),
    ),
  );
  if (messages.length > maxBatchMessages) {
    return { ok: false, code: "whatsapp_payload_invalid" };
  }
  return {
    ok: true,
    messages,
  };
}

function normalizeInboundContent(
  message: z.infer<typeof inboundMessageSchema>,
): {
  text: string | null;
  mediaKind: MetaWhatsAppInboundMediaKind | null;
} {
  switch (message.type) {
    case "text":
      return { text: message.text.body, mediaKind: null };
    case "image":
      return { text: message.image.caption ?? null, mediaKind: "image" };
    case "audio":
      return { text: null, mediaKind: "audio" };
    case "document":
      return {
        text: message.document.caption ?? null,
        mediaKind: "document",
      };
    case "video":
      return { text: message.video.caption ?? null, mediaKind: "video" };
    case "sticker":
      return { text: null, mediaKind: "sticker" };
  }
}
