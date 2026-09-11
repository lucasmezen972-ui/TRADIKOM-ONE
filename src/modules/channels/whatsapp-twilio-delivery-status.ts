import { z } from "zod";
import {
  consumeVerifiedTwilioFormWebhook,
  type TwilioWebhookVerificationResult,
  type VerifiedTwilioFormParameters,
} from "@/modules/channels/whatsapp-twilio-webhook";

const twilioMessageSidSchema = z.string().regex(/^SM[a-fA-F0-9]{32}$/);
const twilioSourceStatusSchema = z.enum([
  "queued",
  "sent",
  "delivered",
  "read",
  "failed",
  "undelivered",
]);

export type VerifiedWhatsAppTwilioDeliveryStatus = {
  providerMessageId: string;
  sourceStatus: z.infer<typeof twilioSourceStatusSchema>;
  status: "accepted" | "delivered" | "failed";
  safeErrorCode: string | null;
};

export type WhatsAppTwilioDeliveryStatusVerificationResult =
  | { ok: true; event: VerifiedWhatsAppTwilioDeliveryStatus }
  | Extract<TwilioWebhookVerificationResult, { ok: false }>;

export function verifyWhatsAppTwilioDeliveryStatus(
  input: unknown,
  authToken: string | undefined,
): WhatsAppTwilioDeliveryStatusVerificationResult {
  const verified = consumeVerifiedTwilioFormWebhook(
    input,
    authToken,
    normalizeStatusCallback,
  );
  if (!verified.ok) return verified;
  return verified.value;
}

function normalizeStatusCallback(
  parameters: VerifiedTwilioFormParameters,
): WhatsAppTwilioDeliveryStatusVerificationResult {
  const providerMessageId = scalar(parameters, "MessageSid");
  const sourceStatus = scalar(parameters, "MessageStatus");
  const parsedMessageSid = twilioMessageSidSchema.safeParse(providerMessageId);
  const parsedStatus = twilioSourceStatusSchema.safeParse(sourceStatus);
  if (!parsedMessageSid.success || !parsedStatus.success) {
    return { ok: false, code: "payload_invalid" };
  }

  const status = normalizeStatus(parsedStatus.data);
  return {
    ok: true,
    event: {
      providerMessageId: parsedMessageSid.data,
      sourceStatus: parsedStatus.data,
      status,
      safeErrorCode:
        status === "failed" ? "provider_delivery_failed" : null,
    },
  };
}

function normalizeStatus(
  status: z.infer<typeof twilioSourceStatusSchema>,
): VerifiedWhatsAppTwilioDeliveryStatus["status"] {
  if (status === "queued" || status === "sent") return "accepted";
  if (status === "delivered" || status === "read") return "delivered";
  return "failed";
}

function scalar(
  parameters: VerifiedTwilioFormParameters,
  name: string,
) {
  const value = parameters[name];
  return typeof value === "string" ? value : undefined;
}
