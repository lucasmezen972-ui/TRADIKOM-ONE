import { z } from "zod";
import {
  channelDeliveryResultSchema,
  sendCanonicalMessageRequestSchema,
  type ChannelAdapterState,
  type ChannelDeliveryResult,
} from "@/modules/channels/contracts";
import {
  WhatsAppMetaTransportError,
  type WhatsAppMetaOutboundTransport,
} from "@/modules/channels/whatsapp-meta-outbound";

const graphBaseUrl = "https://graph.facebook.com";
const maxResponseBytes = 64 * 1024;
const boundedIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const accessTokenSchema = z.string().min(20).max(4_096);
const phoneNumberIdSchema = z.string().regex(/^[1-9][0-9]{5,31}$/);
const graphApiVersionSchema = z.string().regex(/^v[1-9][0-9]{0,2}\.[0-9]{1,2}$/);
const recipientPhoneNumberSchema = z
  .string()
  .trim()
  .regex(/^\+[1-9][0-9]{7,14}$/);
const transportRequestSchema = sendCanonicalMessageRequestSchema.extend({
  endpointId: boundedIdentifierSchema,
});
const credentialsSchema = z
  .object({
    accessToken: accessTokenSchema,
    phoneNumberId: phoneNumberIdSchema,
    graphApiVersion: graphApiVersionSchema,
  })
  .strict();
const destinationSchema = z
  .object({
    recipientPhoneNumber: recipientPhoneNumberSchema,
  })
  .strict();
const providerResponseSchema = z
  .object({
    messages: z
      .array(
        z
          .object({
            id: z.string().trim().min(1).max(256),
          })
          .passthrough(),
      )
      .min(1)
      .max(10),
  })
  .passthrough();
const optionsSchema = z
  .object({
    timeoutMs: z.number().int().min(1_000).max(30_000).default(10_000),
  })
  .strict();

export type WhatsAppMetaCredentialsReference = {
  tenantId: string;
  endpointId: string;
};

export type WhatsAppMetaDestinationReference =
  WhatsAppMetaCredentialsReference & {
    channelIdentityId: string;
  };

export type WhatsAppMetaResolvedCredentials = {
  accessToken: string;
  phoneNumberId: string;
  graphApiVersion: string;
};

export type WhatsAppMetaResolvedDestination = {
  recipientPhoneNumber: string;
};

export type WhatsAppMetaHttpResponse = {
  status: number;
  text(): Promise<string>;
};

export type WhatsAppMetaFetch = (
  url: string,
  init: {
    method: "POST";
    headers: Record<string, string>;
    body: string;
    signal: AbortSignal;
  },
) => Promise<WhatsAppMetaHttpResponse>;

export type WhatsAppMetaTransportDependencies = {
  state: ChannelAdapterState;
  resolveCredentials(
    reference: WhatsAppMetaCredentialsReference,
  ):
    | WhatsAppMetaResolvedCredentials
    | null
    | Promise<WhatsAppMetaResolvedCredentials | null>;
  resolveDestination(
    reference: WhatsAppMetaDestinationReference,
  ):
    | WhatsAppMetaResolvedDestination
    | null
    | Promise<WhatsAppMetaResolvedDestination | null>;
  fetch: WhatsAppMetaFetch;
  timeoutMs?: number;
};

/**
 * Frontière HTTP éphémère pour WhatsApp Cloud API.
 * La composition réelle doit fournir les résolveurs tenant-aware et `fetch`
 * uniquement après autorisation; ce module ne lit aucun secret global.
 */
export function createWhatsAppMetaTransport(
  dependencies: WhatsAppMetaTransportDependencies,
): WhatsAppMetaOutboundTransport {
  const options = optionsSchema.safeParse({
    timeoutMs: dependencies.timeoutMs,
  });
  if (!options.success) throw new WhatsAppMetaTransportError("validation");

  return {
    async sendMessage(input) {
      const unavailable = unavailableResult(dependencies.state);
      if (unavailable) return unavailable;

      const request = transportRequestSchema.safeParse(input);
      if (!request.success) return failedResult("validation");

      let rawCredentials: WhatsAppMetaResolvedCredentials | null;
      try {
        rawCredentials = await dependencies.resolveCredentials({
          tenantId: request.data.tenantId,
          endpointId: request.data.endpointId,
        });
      } catch {
        throw new WhatsAppMetaTransportError("temporary");
      }
      if (!rawCredentials) return notConfiguredResult();
      const credentials = credentialsSchema.safeParse(rawCredentials);
      if (!credentials.success) return failedResult("auth");

      let rawDestination: WhatsAppMetaResolvedDestination | null;
      try {
        rawDestination = await dependencies.resolveDestination({
          tenantId: request.data.tenantId,
          endpointId: request.data.endpointId,
          channelIdentityId: request.data.channelIdentityId,
        });
      } catch {
        throw new WhatsAppMetaTransportError("temporary");
      }
      if (!rawDestination) return notConfiguredResult();
      const destination = destinationSchema.safeParse(rawDestination);
      if (!destination.success) return failedResult("validation");

      const url = `${graphBaseUrl}/${credentials.data.graphApiVersion}/${credentials.data.phoneNumberId}/messages`;
      const body = JSON.stringify({
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: destination.data.recipientPhoneNumber.slice(1),
        type: "text",
        text: {
          preview_url: false,
          body: request.data.text,
        },
      });
      const controller = new AbortController();
      const timeout = setTimeout(
        () => controller.abort(),
        options.data.timeoutMs,
      );

      try {
        const response = await dependencies.fetch(url, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${credentials.data.accessToken}`,
            "Content-Type": "application/json",
          },
          body,
          signal: controller.signal,
        });
        if (
          !Number.isInteger(response.status) ||
          response.status < 100 ||
          response.status > 599 ||
          typeof response.text !== "function"
        ) {
          throw new WhatsAppMetaTransportError("validation");
        }
        if (response.status < 200 || response.status >= 300) {
          throw new WhatsAppMetaTransportError(
            classifyWhatsAppMetaHttpStatus(response.status),
          );
        }

        const rawResponse = await response.text();
        if (new TextEncoder().encode(rawResponse).byteLength > maxResponseBytes) {
          throw new WhatsAppMetaTransportError("validation");
        }
        let decoded: unknown;
        try {
          decoded = JSON.parse(rawResponse);
        } catch {
          throw new WhatsAppMetaTransportError("validation");
        }
        const providerResult = providerResponseSchema.safeParse(decoded);
        if (!providerResult.success) {
          throw new WhatsAppMetaTransportError("validation");
        }
        return channelDeliveryResultSchema.parse({
          status: "accepted",
          provider: "whatsapp_meta",
          externalMessageId: providerResult.data.messages[0].id,
          retryable: false,
        });
      } catch (error) {
        if (error instanceof WhatsAppMetaTransportError) throw error;
        throw new WhatsAppMetaTransportError(
          isNetworkFailure(error) ? "temporary" : "permanent",
        );
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

export function classifyWhatsAppMetaHttpStatus(
  status: number,
): "temporary" | "permanent" | "auth" | "rate_limit" {
  if (status === 401 || status === 403) return "auth";
  if (status === 429) return "rate_limit";
  if (status === 408 || status === 425 || status >= 500) return "temporary";
  return "permanent";
}

function unavailableResult(
  state: ChannelAdapterState,
): ChannelDeliveryResult | null {
  if (state === "mock" || state === "ready") return null;
  return channelDeliveryResultSchema.parse({
    status: state,
    provider: "whatsapp_meta",
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
    provider: "whatsapp_meta",
    errorCode: "channel_not_configured",
    classification: "not_configured",
    retryable: false,
  });
}

function failedResult(classification: "auth" | "validation") {
  return channelDeliveryResultSchema.parse({
    status: "failed",
    provider: "whatsapp_meta",
    errorCode:
      classification === "auth"
        ? "authentication_failed"
        : "validation_failed",
    classification,
    retryable: false,
  });
}

function isNetworkFailure(error: unknown) {
  return (
    error instanceof TypeError ||
    (error instanceof Error && error.name === "AbortError")
  );
}
