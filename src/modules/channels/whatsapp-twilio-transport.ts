import { z } from "zod";
import {
  channelDeliveryResultSchema,
  sendCanonicalMessageRequestSchema,
  type ChannelAdapterState,
  type ChannelDeliveryResult,
} from "@/modules/channels/contracts";
import {
  WhatsAppTwilioTransportError,
  type WhatsAppTwilioOutboundTransport,
} from "@/modules/channels/whatsapp-twilio-outbound";

const boundedIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const accountSidSchema = z.string().regex(/^AC[a-fA-F0-9]{32}$/);
const authTokenSchema = z.string().min(1).max(512);
const whatsappAddressSchema = z
  .string()
  .trim()
  .regex(/^whatsapp:\+[1-9][0-9]{7,14}$/);
const messageSidSchema = z.string().regex(/^(SM|MM)[a-fA-F0-9]{32}$/);
const transportRequestSchema = sendCanonicalMessageRequestSchema.extend({
  endpointId: boundedIdentifierSchema,
});
const credentialsSchema = z
  .object({
    accountSid: accountSidSchema,
    authToken: authTokenSchema,
  })
  .strict();
const destinationSchema = z
  .object({
    senderAddress: whatsappAddressSchema,
    recipientAddress: whatsappAddressSchema,
  })
  .strict();
const clientResponseSchema = z
  .object({
    sid: messageSidSchema,
    status: z.string().trim().min(1).max(64).optional().nullable(),
  })
  .passthrough();

export type WhatsAppTwilioCredentialsReference = {
  tenantId: string;
  endpointId: string;
};

export type WhatsAppTwilioDestinationReference =
  WhatsAppTwilioCredentialsReference & {
    channelIdentityId: string;
  };

export type WhatsAppTwilioResolvedCredentials = {
  accountSid: string;
  authToken: string;
};

export type WhatsAppTwilioResolvedDestination = {
  senderAddress: string;
  recipientAddress: string;
};

export type WhatsAppTwilioClient = {
  messages: {
    create(input: {
      from: string;
      to: string;
      body: string;
      statusCallback: string;
    }): Promise<{ sid: string; status?: string | null }>;
  };
};

export type WhatsAppTwilioClientFactory = (
  credentials: WhatsAppTwilioResolvedCredentials,
) => WhatsAppTwilioClient;

export type WhatsAppTwilioTransportDependencies = {
  state: ChannelAdapterState;
  statusCallbackUrl?: string;
  resolveCredentials(
    reference: WhatsAppTwilioCredentialsReference,
  ):
    | WhatsAppTwilioResolvedCredentials
    | null
    | Promise<WhatsAppTwilioResolvedCredentials | null>;
  resolveDestination(
    reference: WhatsAppTwilioDestinationReference,
  ):
    | WhatsAppTwilioResolvedDestination
    | null
    | Promise<WhatsAppTwilioResolvedDestination | null>;
  createClient: WhatsAppTwilioClientFactory;
};

export function createWhatsAppTwilioTransport(
  dependencies: WhatsAppTwilioTransportDependencies,
): WhatsAppTwilioOutboundTransport {
  return {
    async sendMessage(input) {
      const unavailable = unavailableResult(dependencies.state);
      if (unavailable) return unavailable;

      const request = transportRequestSchema.safeParse(input);
      const statusCallback = parseStatusCallbackUrl(
        dependencies.statusCallbackUrl,
      );
      if (!request.success || !statusCallback) {
        return failedResult("validation", false);
      }

      let rawCredentials: WhatsAppTwilioResolvedCredentials | null;
      try {
        rawCredentials = await dependencies.resolveCredentials({
          tenantId: request.data.tenantId,
          endpointId: request.data.endpointId,
        });
      } catch {
        throw new WhatsAppTwilioTransportError("temporary");
      }
      if (!rawCredentials) return notConfiguredResult();
      const credentials = credentialsSchema.safeParse(rawCredentials);
      if (!credentials.success) return failedResult("auth", false);

      let rawDestination: WhatsAppTwilioResolvedDestination | null;
      try {
        rawDestination = await dependencies.resolveDestination({
          tenantId: request.data.tenantId,
          endpointId: request.data.endpointId,
          channelIdentityId: request.data.channelIdentityId,
        });
      } catch {
        throw new WhatsAppTwilioTransportError("temporary");
      }
      if (!rawDestination) return notConfiguredResult();
      const destination = destinationSchema.safeParse(rawDestination);
      if (!destination.success) return failedResult("validation", false);

      try {
        const client = dependencies.createClient(credentials.data);
        const providerResult = clientResponseSchema.parse(
          await client.messages.create({
            from: destination.data.senderAddress,
            to: destination.data.recipientAddress,
            body: request.data.text,
            statusCallback,
          }),
        );
        return normalizeProviderResult(providerResult);
      } catch (error) {
        if (error instanceof WhatsAppTwilioTransportError) throw error;
        if (error instanceof z.ZodError) {
          throw new WhatsAppTwilioTransportError("validation");
        }
        throw new WhatsAppTwilioTransportError(classifyTwilioClientError(error));
      }
    },
  };
}

export function classifyTwilioClientError(
  error: unknown,
): "temporary" | "permanent" | "auth" | "rate_limit" {
  const status = numericProperty(error, "status");
  const code = numericProperty(error, "code");
  if (
    status === 401 ||
    status === 403 ||
    code === 20_003 ||
    (code !== null && code >= 20_101 && code <= 20_160)
  ) {
    return "auth";
  }
  if (status === 429 || code === 20_429) return "rate_limit";
  if (
    status === 408 ||
    status === 425 ||
    (status !== null && status >= 500) ||
    code === 20_500 ||
    code === 20_503 ||
    code === 20_504 ||
    isNetworkFailure(error)
  ) {
    return "temporary";
  }
  return "permanent";
}

function parseStatusCallbackUrl(value: string | undefined) {
  if (!value || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.hash ||
      !/^[A-Za-z0-9.-]+$/.test(url.hostname)
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

function normalizeProviderResult(
  result: z.output<typeof clientResponseSchema>,
): ChannelDeliveryResult {
  if (
    !result.status ||
    ["accepted", "queued", "sending", "sent"].includes(result.status)
  ) {
    return channelDeliveryResultSchema.parse({
      status: "accepted",
      provider: "whatsapp_twilio",
      externalMessageId: result.sid,
      retryable: false,
    });
  }
  if (["delivered", "read"].includes(result.status)) {
    return channelDeliveryResultSchema.parse({
      status: "delivered",
      provider: "whatsapp_twilio",
      externalMessageId: result.sid,
      retryable: false,
    });
  }
  if (["failed", "undelivered", "canceled"].includes(result.status)) {
    return channelDeliveryResultSchema.parse({
      status: "failed",
      provider: "whatsapp_twilio",
      externalMessageId: result.sid,
      errorCode: "permanent_provider_failure",
      classification: "permanent",
      retryable: false,
    });
  }
  throw new WhatsAppTwilioTransportError("validation");
}

function unavailableResult(
  state: ChannelAdapterState,
): ChannelDeliveryResult | null {
  if (state === "mock" || state === "ready") return null;
  return channelDeliveryResultSchema.parse({
    status: state,
    provider: "whatsapp_twilio",
    errorCode:
      state === "disabled"
        ? "channel_disabled"
        : state === "awaiting_human_auth"
          ? "awaiting_human_auth"
          : "channel_not_configured",
    classification: "not_configured",
    retryable: false,
  });
}

function notConfiguredResult() {
  return channelDeliveryResultSchema.parse({
    status: "not_configured",
    provider: "whatsapp_twilio",
    errorCode: "channel_not_configured",
    classification: "not_configured",
    retryable: false,
  });
}

function failedResult(
  classification: "auth" | "validation",
  retryable: false,
) {
  return channelDeliveryResultSchema.parse({
    status: "failed",
    provider: "whatsapp_twilio",
    errorCode:
      classification === "auth"
        ? "authentication_failed"
        : "validation_failed",
    classification,
    retryable,
  });
}

function numericProperty(error: unknown, property: "status" | "code") {
  if (!error || typeof error !== "object") return null;
  const value = Reflect.get(error, property);
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function isNetworkFailure(error: unknown) {
  return (
    error instanceof TypeError ||
    (error instanceof Error && error.name === "AbortError")
  );
}
