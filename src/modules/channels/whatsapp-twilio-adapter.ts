import { z } from "zod";
import {
  consumeVerifiedTwilioFormWebhook,
  type TwilioWebhookVerificationResult,
  type VerifiedTwilioFormParameters,
} from "@/modules/channels/whatsapp-twilio-webhook";

const twilioMessageSidSchema = z.string().regex(/^SM[a-fA-F0-9]{32}$/);
const twilioAccountSidSchema = z.string().regex(/^AC[a-fA-F0-9]{32}$/);
const whatsappAddressSchema = z
  .string()
  .regex(/^whatsapp:\+[1-9][0-9]{7,14}$/);
const receivedAtSchema = z.string().datetime({ offset: true });
const mediaTypeSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i);

export type PreparedWhatsAppInboundMessage = {
  provider: "whatsapp_twilio";
  adapterKey: "whatsapp-twilio";
  externalMessageId: string;
  safeAccountReference: string;
  senderAddress: string;
  recipientAddress: string;
  text?: string;
  media: Array<{
    externalMediaId: string;
    contentType: string;
    providerUrl: string;
  }>;
  idempotencyKey: string;
  correlationId: string;
  receivedAt: string;
};

export type WhatsAppInboundPreparationResult =
  | { ok: true; message: PreparedWhatsAppInboundMessage }
  | Extract<TwilioWebhookVerificationResult, { ok: false }>
  | { ok: false; code: "whatsapp_payload_invalid" };

/**
 * Produit une enveloppe WhatsApp éphémère uniquement après vérification Twilio.
 * Les adresses et URLs média sont nécessaires au futur mapping tenant mais ne
 * doivent jamais être journalisées ni persistées telles quelles.
 */
export function prepareVerifiedWhatsAppInboundMessage(
  input: unknown,
  authToken: string | undefined,
  receivedAt: string,
): WhatsAppInboundPreparationResult {
  const parsedReceivedAt = receivedAtSchema.safeParse(receivedAt);
  if (!parsedReceivedAt.success) {
    return { ok: false, code: "whatsapp_payload_invalid" };
  }

  const consumed = consumeVerifiedTwilioFormWebhook(
    input,
    authToken,
    (parameters) => normalizeWhatsAppParameters(parameters, parsedReceivedAt.data),
  );
  if (!consumed.ok) return consumed;
  if (!consumed.value) {
    return { ok: false, code: "whatsapp_payload_invalid" };
  }
  return { ok: true, message: consumed.value };
}

function normalizeWhatsAppParameters(
  parameters: VerifiedTwilioFormParameters,
  receivedAt: string,
): PreparedWhatsAppInboundMessage | null {
  const externalMessageId = parseScalar(parameters, "MessageSid", twilioMessageSidSchema);
  const safeAccountReference = parseScalar(
    parameters,
    "AccountSid",
    twilioAccountSidSchema,
  );
  const senderAddress = parseScalar(parameters, "From", whatsappAddressSchema);
  const recipientAddress = parseScalar(parameters, "To", whatsappAddressSchema);
  const mediaCountValue = scalar(parameters, "NumMedia");
  if (
    !externalMessageId ||
    !safeAccountReference ||
    !senderAddress ||
    !recipientAddress ||
    mediaCountValue === null ||
    !/^\d{1,2}$/.test(mediaCountValue)
  ) {
    return null;
  }

  const mediaCount = Number(mediaCountValue);
  if (!Number.isInteger(mediaCount) || mediaCount < 0 || mediaCount > 10) {
    return null;
  }

  const textValue = scalar(parameters, "Body");
  if (textValue === null || textValue.length > 1_600) return null;
  const text = textValue.trim() || undefined;
  const media = parseMedia(parameters, mediaCount);
  if (!media || (!text && media.length === 0)) return null;

  return {
    provider: "whatsapp_twilio",
    adapterKey: "whatsapp-twilio",
    externalMessageId,
    safeAccountReference,
    senderAddress,
    recipientAddress,
    ...(text ? { text } : {}),
    media,
    idempotencyKey: `ingress:whatsapp_twilio:${externalMessageId}`,
    correlationId: `twilio_${externalMessageId}`,
    receivedAt,
  };
}

function parseMedia(
  parameters: VerifiedTwilioFormParameters,
  mediaCount: number,
): PreparedWhatsAppInboundMessage["media"] | null {
  const media: PreparedWhatsAppInboundMessage["media"] = [];
  for (let index = 0; index < mediaCount; index += 1) {
    const urlValue = scalar(parameters, `MediaUrl${index}`);
    const typeValue = scalar(parameters, `MediaContentType${index}`);
    const contentType = mediaTypeSchema.safeParse(typeValue);
    if (!urlValue || !contentType.success) return null;

    let providerUrl: URL;
    try {
      providerUrl = new URL(urlValue);
    } catch {
      return null;
    }
    if (
      providerUrl.protocol !== "https:" ||
      providerUrl.hostname !== "api.twilio.com" ||
      providerUrl.username ||
      providerUrl.password ||
      providerUrl.hash
    ) {
      return null;
    }

    const externalMediaId = providerUrl.pathname.split("/").filter(Boolean).at(-1);
    if (!externalMediaId || !/^[A-Z]{2}[a-fA-F0-9]{32}$/.test(externalMediaId)) {
      return null;
    }

    media.push({
      externalMediaId,
      contentType: contentType.data.toLowerCase(),
      providerUrl: providerUrl.toString(),
    });
  }
  return media;
}

function scalar(
  parameters: VerifiedTwilioFormParameters,
  name: string,
): string | null {
  const value = parameters[name];
  return typeof value === "string" ? value : null;
}

function parseScalar<T extends z.ZodType<string>>(
  parameters: VerifiedTwilioFormParameters,
  name: string,
  schema: T,
) {
  const parsed = schema.safeParse(scalar(parameters, name));
  return parsed.success ? parsed.data : null;
}
