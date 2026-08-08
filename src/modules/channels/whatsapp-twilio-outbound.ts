import {
  channelAdapterManifestSchema,
  channelDeliveryResultSchema,
  normalizedChannelProviderErrorSchema,
  sendCanonicalMessageRequestSchema,
  type ChannelAdapter,
  type ChannelAdapterManifest,
  type ChannelDeliveryResult,
  type ChannelProviderErrorCode,
  type ChannelProviderFailureClassification,
  type NormalizedChannelProviderError,
  type SendCanonicalMessageRequest,
} from "@/modules/channels/contracts";

export type WhatsAppTwilioOutboundTransport = {
  sendMessage(
    input: SendCanonicalMessageRequest,
  ): Promise<ChannelDeliveryResult>;
};

export type WhatsAppTwilioOutboundAdapter = Pick<
  ChannelAdapter,
  "manifest" | "sendMessage" | "normalizeError"
>;

export class WhatsAppTwilioTransportError extends Error {
  constructor(
    public readonly classification: Exclude<
      ChannelProviderFailureClassification,
      "policy" | "validation" | "not_configured"
    >,
  ) {
    super("Le transport WhatsApp a échoué.");
    this.name = "WhatsAppTwilioTransportError";
  }
}

export function createWhatsAppTwilioOutboundAdapter(input: {
  manifest: ChannelAdapterManifest;
  transport?: WhatsAppTwilioOutboundTransport;
}): WhatsAppTwilioOutboundAdapter {
  const manifest = channelAdapterManifestSchema.parse(input.manifest);
  if (manifest.provider !== "whatsapp_twilio") {
    throw new Error("Le manifeste WhatsApp/Twilio est invalide.");
  }

  return {
    manifest,
    async sendMessage(rawInput) {
      const parsed = sendCanonicalMessageRequestSchema.safeParse(rawInput);
      if (!parsed.success) {
        return failedResult("validation", false);
      }
      if (parsed.data.text.length > manifest.capabilities.maxTextLength) {
        return failedResult("validation", false);
      }

      const unavailable = unavailableResult(manifest.state);
      if (unavailable) return unavailable;
      if (!manifest.transportEnabled || !input.transport) {
        return unavailableResult("not_configured")!;
      }

      try {
        const outcome = channelDeliveryResultSchema.parse(
          await input.transport.sendMessage(parsed.data),
        );
        if (outcome.provider !== "whatsapp_twilio") {
          return failedResult("validation", false);
        }
        return outcome;
      } catch (error) {
        const normalized = normalizeWhatsAppTwilioError(error);
        return channelDeliveryResultSchema.parse({
          status: "failed",
          provider: "whatsapp_twilio",
          errorCode: normalized.code,
          classification: normalized.classification,
          retryable: normalized.retryable,
        });
      }
    },
    normalizeError: normalizeWhatsAppTwilioError,
  };
}

export function normalizeWhatsAppTwilioError(
  error: unknown,
): NormalizedChannelProviderError {
  const classification =
    error instanceof WhatsAppTwilioTransportError
      ? error.classification
      : "permanent";
  return normalizedChannelProviderErrorSchema.parse({
    provider: "whatsapp_twilio",
    code: errorCode(classification),
    classification,
    safeMessage: safeMessage(classification),
    retryable: classification === "temporary" || classification === "rate_limit",
  });
}

function unavailableResult(
  state: ChannelAdapterManifest["state"],
): ChannelDeliveryResult | null {
  if (state === "ready" || state === "mock") return null;

  const errorCode =
    state === "disabled"
      ? "channel_disabled"
      : state === "awaiting_human_auth"
        ? "awaiting_human_auth"
        : "channel_not_configured";
  return channelDeliveryResultSchema.parse({
    status: state,
    provider: "whatsapp_twilio",
    errorCode,
    classification: "not_configured",
    retryable: false,
  });
}

function failedResult(
  classification: ChannelProviderFailureClassification,
  retryable: boolean,
) {
  return channelDeliveryResultSchema.parse({
    status: "failed",
    provider: "whatsapp_twilio",
    errorCode: errorCode(classification),
    classification,
    retryable,
  });
}

function errorCode(
  classification: ChannelProviderFailureClassification,
): ChannelProviderErrorCode {
  return {
    temporary: "temporary_provider_failure",
    permanent: "permanent_provider_failure",
    auth: "authentication_failed",
    rate_limit: "rate_limited",
    policy: "policy_denied",
    validation: "validation_failed",
    not_configured: "channel_not_configured",
  }[classification] as ChannelProviderErrorCode;
}

function safeMessage(classification: ChannelProviderFailureClassification) {
  return {
    temporary: "Le canal WhatsApp est temporairement indisponible.",
    permanent: "Le canal WhatsApp a refusé définitivement le message.",
    auth: "L'authentification du canal WhatsApp doit être renouvelée.",
    rate_limit: "Le quota WhatsApp est temporairement épuisé.",
    policy: "La politique interdit cet envoi WhatsApp.",
    validation: "Le message WhatsApp est invalide.",
    not_configured: "Le canal WhatsApp n'est pas configuré.",
  }[classification];
}
