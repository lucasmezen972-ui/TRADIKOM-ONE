import { z } from "zod";
import {
  channelAdapterManifestSchema,
  type ChannelAdapterManifest,
} from "@/modules/channels/contracts";
import {
  inspectChannelProviderSecretKeyReferences,
  type ChannelProviderSecretReferenceResolver,
} from "@/modules/channels/channel-provider-secrets-bootstrap";
import type { ChannelProviderSecretKeyring } from "@/modules/channels/channel-provider-secrets-crypto";
import type {
  WhatsAppTwilioActivationAuthorizationLoader,
  WhatsAppTwilioStoredActivationAuthorization,
} from "@/modules/channels/whatsapp-twilio-activation-authorization-service";
import { createWhatsAppTwilioTransport } from "@/modules/channels/whatsapp-twilio-transport";
import type {
  WhatsAppTwilioClientFactory,
  WhatsAppTwilioTransportDependencies,
} from "@/modules/channels/whatsapp-twilio-transport";

type Environment = Record<string, string | undefined>;

const boundedIdentifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);
const endpointSchema = z
  .object({
    tenantId: boundedIdentifierSchema,
    endpointId: boundedIdentifierSchema,
    provider: z.literal("whatsapp_twilio"),
    status: z.enum(["active", "disabled"]),
  })
  .strict();
const storedAuthorizationSchema = z
  .object({
    authorizationId: boundedIdentifierSchema,
    tenantId: boundedIdentifierSchema,
    endpointId: boundedIdentifierSchema,
    provider: z.literal("whatsapp_twilio"),
    authorizedBy: boundedIdentifierSchema,
    authorizedAt: z.string().datetime({ offset: true }),
    expiresAt: z.string().datetime({ offset: true }),
    scope: z.literal("twilio_whatsapp_sandbox"),
    maxMessages: z.number().int().min(1).max(2),
    freeUnitsConfirmed: z.literal(true),
    revokedAt: z.string().datetime({ offset: true }).nullable(),
  })
  .strict()
  .superRefine((authorization, context) => {
    if (
      Date.parse(authorization.expiresAt) <= Date.parse(authorization.authorizedAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["expiresAt"],
        message: "L'autorisation doit expirer après sa création.",
      });
    }
    if (
      authorization.revokedAt &&
      Date.parse(authorization.revokedAt) < Date.parse(authorization.authorizedAt)
    ) {
      context.addIssue({
        code: "custom",
        path: ["revokedAt"],
        message: "La révocation ne peut pas précéder l'autorisation.",
      });
    }
  });

export type WhatsAppTwilioReadinessState =
  | "disabled"
  | "not_configured"
  | "awaiting_human_auth"
  | "degraded"
  | "ready";

export type WhatsAppTwilioReadiness = {
  provider: "whatsapp_twilio";
  state: WhatsAppTwilioReadinessState;
  activationAllowed: boolean;
  message: string;
  checks: {
    manifest: "disabled" | "incomplete" | "prepared" | "ready";
    keyReferences: "not_checked" | "missing" | "invalid" | "valid";
    endpoint:
      | "not_checked"
      | "missing"
      | "tenant_mismatch"
      | "disabled"
      | "active";
    webhookUrl: "not_checked" | "missing" | "invalid" | "valid";
    statusCallbackUrl: "not_checked" | "missing" | "invalid" | "valid";
    humanAuthorization:
      | "not_checked"
      | "required"
      | "invalid"
      | "expired"
      | "revoked"
      | "unavailable"
      | "valid";
  };
};

export type WhatsAppTwilioActivationInput = {
  tenantId: string;
  manifest: ChannelAdapterManifest;
  environment?: Environment;
  endpoint?: z.input<typeof endpointSchema> | null;
  authorizationId?: string | null;
  now: string;
};

export type WhatsAppTwilioActivationDependencies = {
  loadAuthorization: WhatsAppTwilioActivationAuthorizationLoader;
  bootstrapKeyring(input: {
    environment: Environment;
    secretManager: ChannelProviderSecretReferenceResolver;
  }): Promise<ChannelProviderSecretKeyring>;
  secretManager: ChannelProviderSecretReferenceResolver;
  createSecretResolvers(
    keyring: ChannelProviderSecretKeyring,
  ): Pick<
    WhatsAppTwilioTransportDependencies,
    "resolveCredentials" | "resolveDestination"
  >;
  createClientFactory(): WhatsAppTwilioClientFactory;
};

export async function inspectWhatsAppTwilioReadiness(
  input: WhatsAppTwilioActivationInput,
  loadAuthorization: WhatsAppTwilioActivationAuthorizationLoader,
): Promise<WhatsAppTwilioReadiness> {
  return (await resolveReadiness(input, loadAuthorization)).readiness;
}

export async function composeWhatsAppTwilioActivation(
  input: WhatsAppTwilioActivationInput,
  dependencies: WhatsAppTwilioActivationDependencies,
) {
  const evaluation = await resolveReadiness(
    input,
    dependencies.loadAuthorization,
  );
  if (!evaluation.readiness.activationAllowed || !evaluation.statusCallbackUrl) {
    return { readiness: evaluation.readiness, transport: null };
  }

  const environment = input.environment ?? process.env;
  const keyring = await dependencies.bootstrapKeyring({
    environment,
    secretManager: dependencies.secretManager,
  });
  const resolvers = dependencies.createSecretResolvers(keyring);
  const createClient = dependencies.createClientFactory();
  return {
    readiness: evaluation.readiness,
    transport: createWhatsAppTwilioTransport({
      state: "ready",
      statusCallbackUrl: evaluation.statusCallbackUrl,
      ...resolvers,
      createClient,
    }),
  };
}

async function resolveReadiness(
  input: WhatsAppTwilioActivationInput,
  loadAuthorization: WhatsAppTwilioActivationAuthorizationLoader,
) {
  const technical = evaluateReadiness(input, undefined);
  if (
    technical.readiness.state === "disabled" ||
    technical.readiness.state === "not_configured" ||
    !input.authorizationId
  ) {
    return technical;
  }

  const authorizationId = boundedIdentifierSchema.safeParse(
    input.authorizationId,
  );
  const endpoint = endpointSchema.safeParse(input.endpoint);
  if (!authorizationId.success || !endpoint.success) {
    return evaluateReadiness(input, null);
  }
  try {
    const authorization = await loadAuthorization({
      tenantId: input.tenantId,
      endpointId: endpoint.data.endpointId,
      authorizationId: authorizationId.data,
    });
    return evaluateReadiness(input, authorization);
  } catch {
    return evaluateReadiness(input, "unavailable");
  }
}

function evaluateReadiness(
  input: WhatsAppTwilioActivationInput,
  authorization:
    | WhatsAppTwilioStoredActivationAuthorization
    | null
    | undefined
    | "unavailable",
): {
  readiness: WhatsAppTwilioReadiness;
  statusCallbackUrl: string | null;
} {
  const baseChecks: WhatsAppTwilioReadiness["checks"] = {
    manifest: "incomplete",
    keyReferences: "not_checked",
    endpoint: "not_checked",
    webhookUrl: "not_checked",
    statusCallbackUrl: "not_checked",
    humanAuthorization: "not_checked",
  };
  const tenantId = boundedIdentifierSchema.safeParse(input.tenantId);
  const now = z.string().datetime({ offset: true }).safeParse(input.now);
  const manifest = channelAdapterManifestSchema.safeParse(input.manifest);
  if (
    !tenantId.success ||
    !now.success ||
    !manifest.success ||
    manifest.data.provider !== "whatsapp_twilio"
  ) {
    return result(
      "not_configured",
      "La préparation WhatsApp est invalide.",
      baseChecks,
    );
  }
  if (manifest.data.state === "disabled") {
    return result("disabled", "Le canal WhatsApp est désactivé.", {
      ...baseChecks,
      manifest: "disabled",
    });
  }

  const environment = input.environment ?? process.env;
  const keyReferences = inspectKeyReferences(environment);
  const parsedEndpoint = endpointSchema.safeParse(input.endpoint);
  const endpoint = inspectEndpoint(input.endpoint, tenantId.data);
  const webhookUrl = inspectHttpsUrl(environment.TWILIO_WHATSAPP_WEBHOOK_URL);
  const statusCallbackUrl = inspectHttpsUrl(
    environment.TWILIO_WHATSAPP_STATUS_CALLBACK_URL,
  );
  const humanAuthorization = inspectHumanAuthorization(
    authorization,
    tenantId.data,
    parsedEndpoint.success ? parsedEndpoint.data.endpointId : undefined,
    now.data,
  );
  const checks: WhatsAppTwilioReadiness["checks"] = {
    manifest:
      manifest.data.state === "ready" && manifest.data.transportEnabled
        ? "ready"
        : manifest.data.state === "not_configured"
          ? "incomplete"
          : "prepared",
    keyReferences,
    endpoint,
    webhookUrl: webhookUrl.state,
    statusCallbackUrl: statusCallbackUrl.state,
    humanAuthorization,
  };

  if (
    manifest.data.state === "not_configured" ||
    keyReferences !== "valid" ||
    endpoint !== "active" ||
    webhookUrl.state !== "valid" ||
    statusCallbackUrl.state !== "valid"
  ) {
    return result(
      "not_configured",
      "La configuration WhatsApp doit être complétée ou corrigée.",
      checks,
    );
  }
  if (humanAuthorization !== "valid") {
    if (humanAuthorization === "unavailable") {
      return result(
        "degraded",
        "La vérification de l'autorisation est momentanément indisponible.",
        checks,
      );
    }
    return result(
      "awaiting_human_auth",
      "Une autorisation humaine bornée est requise avant l'activation.",
      checks,
    );
  }
  if (manifest.data.state !== "ready" || !manifest.data.transportEnabled) {
    return result(
      "degraded",
      "Les prérequis sont validés, mais le transport réel reste désactivé.",
      checks,
    );
  }
  return result(
    "ready",
    "Le transport WhatsApp est prêt pour le test explicitement autorisé.",
    checks,
    true,
    statusCallbackUrl.value,
  );
}

function inspectKeyReferences(
  environment: Environment,
): WhatsAppTwilioReadiness["checks"]["keyReferences"] {
  if (
    !environment.CHANNEL_PROVIDER_SECRET_ACTIVE_KEY_VERSION?.trim() ||
    !environment.CHANNEL_PROVIDER_SECRET_KEY_REFERENCES?.trim()
  ) {
    return "missing";
  }
  try {
    inspectChannelProviderSecretKeyReferences(environment);
    return "valid";
  } catch {
    return "invalid";
  }
}

function inspectEndpoint(
  endpoint: WhatsAppTwilioActivationInput["endpoint"],
  tenantId: string,
): WhatsAppTwilioReadiness["checks"]["endpoint"] {
  if (!endpoint) return "missing";
  const parsed = endpointSchema.safeParse(endpoint);
  if (!parsed.success || parsed.data.tenantId !== tenantId) {
    return "tenant_mismatch";
  }
  return parsed.data.status === "active" ? "active" : "disabled";
}

function inspectHttpsUrl(value: string | undefined): {
  state: WhatsAppTwilioReadiness["checks"][
    "webhookUrl" | "statusCallbackUrl"
  ];
  value: string | null;
} {
  if (!value?.trim()) return { state: "missing", value: null };
  if (value.length > 2_048) return { state: "invalid", value: null };
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      !parsed.hostname ||
      parsed.username ||
      parsed.password ||
      parsed.hash ||
      !/^[A-Za-z0-9.-]+$/.test(parsed.hostname)
    ) {
      return { state: "invalid", value: null };
    }
    return { state: "valid", value: parsed.toString() };
  } catch {
    return { state: "invalid", value: null };
  }
}

function inspectHumanAuthorization(
  authorization:
    | WhatsAppTwilioStoredActivationAuthorization
    | null
    | undefined
    | "unavailable",
  tenantId: string,
  endpointId: string | undefined,
  now: string,
): WhatsAppTwilioReadiness["checks"]["humanAuthorization"] {
  if (authorization === undefined) return "required";
  if (authorization === null) return "invalid";
  if (authorization === "unavailable") return "unavailable";
  const parsed = storedAuthorizationSchema.safeParse(authorization);
  if (!parsed.success) return "invalid";
  if (
    parsed.data.tenantId !== tenantId ||
    !endpointId ||
    parsed.data.endpointId !== endpointId
  ) {
    return "invalid";
  }
  if (parsed.data.revokedAt) return "revoked";
  if (Date.parse(parsed.data.expiresAt) <= Date.parse(now)) return "expired";
  return "valid";
}

function result(
  state: WhatsAppTwilioReadinessState,
  message: string,
  checks: WhatsAppTwilioReadiness["checks"],
  activationAllowed = false,
  statusCallbackUrl: string | null = null,
) {
  return {
    readiness: {
      provider: "whatsapp_twilio" as const,
      state,
      activationAllowed,
      message,
      checks,
    },
    statusCallbackUrl,
  };
}
