import {
  channelAdapterManifestSchema,
  externalChannelProviderSchema,
  type ChannelAdapterManifest,
  type ExternalChannelProvider,
} from "@/modules/channels/contracts";

type Environment = Record<string, string | undefined>;

type PreparedProviderDefinition = Omit<
  ChannelAdapterManifest,
  "state" | "missingEnvironment" | "transportEnabled"
> & { transportEnabled: false };

const definitions: Record<
  ExternalChannelProvider,
  PreparedProviderDefinition
> = {
  whatsapp_twilio: {
    provider: "whatsapp_twilio",
    channelKind: "messaging",
    displayName: "WhatsApp via Twilio",
    featureFlag: "FEATURE_CHANNEL_WHATSAPP",
    requiredEnvironment: [
      "TWILIO_ACCOUNT_SID",
      "TWILIO_AUTH_TOKEN",
      "TWILIO_WHATSAPP_SENDER",
      "TWILIO_WHATSAPP_WEBHOOK_URL",
      "TWILIO_WHATSAPP_STATUS_CALLBACK_URL",
    ],
    signatureScheme: "twilio_sdk",
    capabilities: {
      supportsThreads: false,
      supportsReadReceipts: true,
      supportsReactions: false,
      supportsFiles: true,
      supportsAudio: true,
      maxTextLength: 1_600,
      maxPayloadBytes: 512 * 1024,
    },
    transportEnabled: false,
  },
  teams_microsoft: {
    provider: "teams_microsoft",
    channelKind: "collaboration",
    displayName: "Microsoft Teams",
    featureFlag: "FEATURE_CHANNEL_TEAMS",
    requiredEnvironment: [
      "MICROSOFT_TENANT_ID",
      "MICROSOFT_CLIENT_ID",
      "MICROSOFT_CLIENT_SECRET",
    ],
    signatureScheme: "microsoft_jwt",
    capabilities: {
      supportsThreads: true,
      supportsReadReceipts: false,
      supportsReactions: true,
      supportsFiles: true,
      supportsAudio: false,
      maxTextLength: 28_000,
      maxPayloadBytes: 1024 * 1024,
    },
    transportEnabled: false,
  },
  slack: {
    provider: "slack",
    channelKind: "collaboration",
    displayName: "Slack",
    featureFlag: "FEATURE_CHANNEL_SLACK",
    requiredEnvironment: [
      "SLACK_CLIENT_ID",
      "SLACK_CLIENT_SECRET",
      "SLACK_SIGNING_SECRET",
    ],
    signatureScheme: "slack_v0_hmac_sha256",
    capabilities: {
      supportsThreads: true,
      supportsReadReceipts: false,
      supportsReactions: true,
      supportsFiles: true,
      supportsAudio: false,
      maxTextLength: 40_000,
      maxPayloadBytes: 1024 * 1024,
    },
    transportEnabled: false,
  },
  email_resend: {
    provider: "email_resend",
    channelKind: "email",
    displayName: "Email via Resend",
    featureFlag: "FEATURE_CHANNEL_EMAIL",
    requiredEnvironment: [
      "RESEND_API_KEY",
      "EMAIL_FROM",
      "RESEND_WEBHOOK_SECRET",
    ],
    signatureScheme: "resend_svix",
    capabilities: {
      supportsThreads: true,
      supportsReadReceipts: false,
      supportsReactions: false,
      supportsFiles: true,
      supportsAudio: false,
      maxTextLength: 100_000,
      maxPayloadBytes: 2 * 1024 * 1024,
    },
    transportEnabled: false,
  },
};

export function listPreparedChannelProviders(
  environment: Environment = process.env,
) {
  return externalChannelProviderSchema.options.map((provider) =>
    getPreparedChannelProvider(provider, environment),
  );
}

export function getPreparedChannelProvider(
  provider: ExternalChannelProvider,
  environment: Environment = process.env,
) {
  const definition = definitions[provider];
  const enabled = environment[definition.featureFlag] === "true";
  const missingEnvironment = definition.requiredEnvironment.filter(
    (name) => !environment[name]?.trim(),
  );
  const state = !enabled
    ? "disabled"
    : missingEnvironment.length > 0
      ? "not_configured"
      : "awaiting_human_auth";

  return channelAdapterManifestSchema.parse({
    ...definition,
    state,
    missingEnvironment: state === "not_configured" ? missingEnvironment : [],
  });
}
