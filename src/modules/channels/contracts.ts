import { z } from "zod";
import type {
  CanonicalMessage,
  MessageAttachment,
} from "@/modules/conversation-hub";

export const externalChannelProviderSchema = z.enum([
  "whatsapp_twilio",
  "teams_microsoft",
  "slack",
  "email_resend",
]);

export const channelAdapterStateSchema = z.enum([
  "disabled",
  "not_configured",
  "awaiting_human_auth",
  "ready",
]);

export const channelProviderErrorCodeSchema = z.enum([
  "channel_disabled",
  "channel_not_configured",
  "awaiting_human_auth",
  "invalid_signature",
  "payload_too_large",
  "unsupported_content_type",
  "temporary_provider_failure",
  "permanent_provider_failure",
  "policy_denied",
]);

export const channelAdapterCapabilitiesSchema = z
  .object({
    supportsThreads: z.boolean(),
    supportsReadReceipts: z.boolean(),
    supportsReactions: z.boolean(),
    supportsFiles: z.boolean(),
    supportsAudio: z.boolean(),
    maxTextLength: z.number().int().min(1).max(100_000),
    maxPayloadBytes: z.number().int().min(1_024).max(5 * 1024 * 1024),
  })
  .strict();

export const channelAdapterManifestSchema = z
  .object({
    provider: externalChannelProviderSchema,
    channelKind: z.enum(["messaging", "email", "collaboration"]),
    displayName: z.string().trim().min(1).max(80),
    state: channelAdapterStateSchema,
    featureFlag: z.string().regex(/^FEATURE_CHANNEL_[A-Z_]+$/),
    requiredEnvironment: z
      .array(z.string().regex(/^[A-Z][A-Z0-9_]+$/))
      .min(1)
      .max(12),
    missingEnvironment: z
      .array(z.string().regex(/^[A-Z][A-Z0-9_]+$/))
      .max(12),
    signatureScheme: z.enum([
      "twilio_sdk",
      "microsoft_jwt",
      "slack_v0_hmac_sha256",
      "resend_svix",
    ]),
    capabilities: channelAdapterCapabilitiesSchema,
    transportEnabled: z.boolean(),
  })
  .strict()
  .superRefine((manifest, context) => {
    if (
      manifest.state === "not_configured" &&
      manifest.missingEnvironment.length === 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["missingEnvironment"],
        message: "Un canal non configuré doit lister sa configuration manquante.",
      });
    }
    if (
      manifest.state !== "not_configured" &&
      manifest.missingEnvironment.length > 0
    ) {
      context.addIssue({
        code: "custom",
        path: ["missingEnvironment"],
        message: "Seul un canal non configuré peut déclarer des variables manquantes.",
      });
    }
    if (manifest.state === "ready" && !manifest.transportEnabled) {
      context.addIssue({
        code: "custom",
        path: ["transportEnabled"],
        message: "Un canal prêt doit avoir un transport explicitement activé.",
      });
    }
    if (manifest.state !== "ready" && manifest.transportEnabled) {
      context.addIssue({
        code: "custom",
        path: ["transportEnabled"],
        message: "Un transport ne peut être activé que lorsque le canal est prêt.",
      });
    }
  });

const boundedHeadersSchema = z
  .record(z.string().trim().min(1).max(120), z.string().max(4_096))
  .superRefine((headers, context) => {
    if (Object.keys(headers).length > 64) {
      context.addIssue({
        code: "custom",
        message: "Un webhook ne peut pas contenir plus de 64 en-têtes.",
      });
    }
  });

export const incomingChannelWebhookSchema = z
  .object({
    provider: externalChannelProviderSchema,
    url: z.string().url().max(2_048),
    contentType: z.string().trim().min(1).max(160),
    rawBody: z.string().max(512 * 1024),
    headers: boundedHeadersSchema,
    receivedAt: z.string().datetime({ offset: true }),
  })
  .strict();

export const verifiedChannelWebhookSchema = incomingChannelWebhookSchema.extend({
  signatureVerified: z.literal(true),
  externalEventId: z.string().trim().min(1).max(256),
  safeAccountReference: z.string().trim().min(1).max(160).optional(),
});

export const sendCanonicalMessageRequestSchema = z
  .object({
    tenantId: z.string().trim().min(1).max(160),
    channelIdentityId: z.string().trim().min(1).max(160),
    messageId: z.string().trim().min(1).max(160),
    idempotencyKey: z.string().trim().min(8).max(160),
    text: z.string().trim().min(1).max(100_000),
  })
  .strict();

export const authorizedAttachmentRequestSchema = z
  .object({
    tenantId: z.string().trim().min(1).max(160),
    messageId: z.string().trim().min(1).max(160),
    attachmentIds: z
      .array(z.string().trim().min(1).max(160))
      .min(1)
      .max(10),
  })
  .strict();

export const channelDeliveryResultSchema = z
  .object({
    status: z.enum([
      "disabled",
      "not_configured",
      "awaiting_human_auth",
      "accepted",
      "delivered",
      "failed",
    ]),
    provider: externalChannelProviderSchema,
    externalMessageId: z.string().trim().min(1).max(256).optional(),
    errorCode: channelProviderErrorCodeSchema.optional(),
    retryable: z.boolean(),
  })
  .strict();

export const normalizedChannelProviderErrorSchema = z
  .object({
    provider: externalChannelProviderSchema,
    code: channelProviderErrorCodeSchema,
    safeMessage: z.string().trim().min(1).max(240),
    retryable: z.boolean(),
    statusCode: z.number().int().min(400).max(599).optional(),
  })
  .strict();

export type ExternalChannelProvider = z.infer<
  typeof externalChannelProviderSchema
>;
export type ChannelAdapterState = z.infer<typeof channelAdapterStateSchema>;
export type ChannelProviderErrorCode = z.infer<
  typeof channelProviderErrorCodeSchema
>;
export type ChannelAdapterManifest = z.infer<
  typeof channelAdapterManifestSchema
>;
export type IncomingChannelWebhook = z.infer<
  typeof incomingChannelWebhookSchema
>;
export type VerifiedChannelWebhook = z.infer<
  typeof verifiedChannelWebhookSchema
>;
export type SendCanonicalMessageRequest = z.infer<
  typeof sendCanonicalMessageRequestSchema
>;
export type AuthorizedAttachmentRequest = z.infer<
  typeof authorizedAttachmentRequestSchema
>;
export type ChannelDeliveryResult = z.infer<
  typeof channelDeliveryResultSchema
>;
export type NormalizedChannelProviderError = z.infer<
  typeof normalizedChannelProviderErrorSchema
>;

export interface ChannelAdapter {
  readonly manifest: ChannelAdapterManifest;
  verifyWebhook(input: IncomingChannelWebhook): Promise<VerifiedChannelWebhook>;
  normalizeInbound(input: VerifiedChannelWebhook): Promise<CanonicalMessage[]>;
  fetchAuthorizedAttachments(
    input: AuthorizedAttachmentRequest,
  ): Promise<MessageAttachment[]>;
  sendMessage(
    input: SendCanonicalMessageRequest,
  ): Promise<ChannelDeliveryResult>;
  normalizeError(error: unknown): NormalizedChannelProviderError;
}
