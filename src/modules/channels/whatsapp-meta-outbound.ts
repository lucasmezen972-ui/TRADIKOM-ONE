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

export type WhatsAppMetaOutboundTransport = {
  sendMessage(
    input: SendCanonicalMessageRequest,
  ): Promise<ChannelDeliveryResult>;
};

export type WhatsAppMetaOutboundAdapter = Pick<
  ChannelAdapter,
  "manifest" | "sendMessage" | "normalizeError"
>;

export class WhatsAppMetaTransportError extends Error {
  constructor(
    public readonly classification: Exclude<
      ChannelProviderFailureClassification,
      "policy" | "not_configured"
    >,
  ) {
    super("Le transport WhatsApp Meta a échoué.");
    this.name = "WhatsAppMetaTransportError";
  }
}

/**
 * Prépare le contrat sortant Meta. Le transport reste une dépendance explicite :
 * le registre préparé ne peut pas activer Graph API à lui seul.
 */
export function createWhatsAppMetaOutboundAdapter(input: {
  manifest: ChannelAdapterManifest;
  transport?: WhatsAppMetaOutboundTransport;
}): WhatsAppMetaOutboundAdapter {
  const manifest = channelAdapterManifestSchema.parse(input.manifest);
  if (manifest.provider !== "whatsapp_meta") {
    throw new Error("Le manifeste WhatsApp Meta est invalide.");
  }

  return {
    manifest,
    async sendMessage(rawInput) {
      const parsed = sendCanonicalMessageRequestSchema.safeParse(rawInput);
      if (!parsed.success) return failedResult("validation", false);
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
        if (outcome.provider !== "whatsapp_meta") {
          return failedResult("validation", false);
        }
        return outcome;
      } catch (error) {
        const normalized = normalizeWhatsAppMetaError(error);
        return channelDeliveryResultSchema.parse({
          status: "failed",
          provider: "whatsapp_meta",
          errorCode: normalized.code,
          classification: normalized.classification,
          retryable: normalized.retryable,
        });
      }
    },
    normalizeError: normalizeWhatsAppMetaError,
  };
}

export function normalizeWhatsAppMetaError(
  error: unknown,
): NormalizedChannelProviderError {
  const classification =
    error instanceof WhatsAppMetaTransportError
      ? error.classification
      : "permanent";
  return normalizedChannelProviderErrorSchema.parse({
    provider: "whatsapp_meta",
    code: errorCode(classification),
    classification,
    safeMessage: safeMessage(classification),
    retryable: classification === "temporary" || classification === "rate_limit",
  });
}

function unavailableResult(
  state: ChannelAdapterManifest["state"],
): ChannelDeliveryResult | null {
  if (state === "mock" || state === "ready") return null;

  const errorCode =
    state === "disabled"
      ? "channel_disabled"
      : state === "awaiting_human_auth"
        ? "awaiting_human_auth"
        : "channel_not_configured";
  return channelDeliveryResultSchema.parse({
    status: state,
    provider: "whatsapp_meta",
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
    provider: "whatsapp_meta",
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
