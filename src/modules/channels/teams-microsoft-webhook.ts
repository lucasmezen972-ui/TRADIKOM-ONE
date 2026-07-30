import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { ServiceTokenValidator } from "@microsoft/teams.apps/dist/middleware";
import { z } from "zod";

const maxTeamsWebhookBytes = 1024 * 1024;
const uuidSchema = z
  .string()
  .uuid()
  .transform((value) => value.toLowerCase());
const safeIdentifierSchema = z.string().trim().min(1).max(512);
const serviceUrlSchema = z
  .string()
  .url()
  .max(2_048)
  .refine(isSafeHttpsUrl, "L'URL de service Teams doit être HTTPS.");

const teamsActivityProjectionSchema = z.object({
  type: z.string().trim().min(1).max(64),
  id: z.string().trim().min(1).max(256),
  timestamp: z.string().datetime({ offset: true }),
  serviceUrl: serviceUrlSchema,
  channelId: z.literal("msteams"),
  from: z.object({ id: safeIdentifierSchema }),
  recipient: z.object({ id: safeIdentifierSchema }),
  conversation: z.object({ id: safeIdentifierSchema }),
  channelData: z.object({ tenant: z.object({ id: uuidSchema }) }),
  text: z.string().max(28_000).optional(),
  attachments: z.array(z.unknown()).max(10).optional(),
});

export const preparedTeamsInboundMessageSchema = z
  .object({
    provider: z.literal("teams_microsoft"),
    adapterKey: z.literal("teams-microsoft"),
    externalMessageId: z.string().trim().min(1).max(256),
    microsoftTenantId: uuidSchema,
    senderSubject: safeIdentifierSchema,
    recipientSubject: safeIdentifierSchema,
    conversationSubject: safeIdentifierSchema,
    text: z.string().trim().min(1).max(28_000).optional(),
    attachmentCount: z.number().int().min(0).max(10),
    idempotencyKey: z
      .string()
      .trim()
      .min(8)
      .max(160)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
    correlationId: z
      .string()
      .trim()
      .min(8)
      .max(160)
      .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
    receivedAt: z.string().datetime({ offset: true }),
  })
  .strict()
  .superRefine((message, context) => {
    const eventFingerprint = fingerprintTeamsEvent(message.externalMessageId);
    if (!message.text && message.attachmentCount === 0) {
      context.addIssue({
        code: "custom",
        path: ["text"],
        message: "Un message Teams doit contenir du texte ou une pièce jointe.",
      });
    }
    if (
      message.idempotencyKey !==
      `ingress:teams_microsoft:${eventFingerprint}`
    ) {
      context.addIssue({
        code: "custom",
        path: ["idempotencyKey"],
        message: "La clé d'idempotence Teams ne correspond pas à l'activité.",
      });
    }
    if (message.correlationId !== `teams_${eventFingerprint}`) {
      context.addIssue({
        code: "custom",
        path: ["correlationId"],
        message: "La corrélation Teams ne correspond pas à l'activité.",
      });
    }
  });

export type PreparedTeamsInboundMessage = z.infer<
  typeof preparedTeamsInboundMessageSchema
>;

type TeamsServiceTokenValidator = {
  check(authorization: string, activity: unknown): Promise<unknown>;
};

export type TeamsWebhookVerificationResult =
  | { ok: true; message: PreparedTeamsInboundMessage }
  | {
      ok: false;
      code:
        | "invalid_authorization"
        | "invalid_activity"
        | "payload_too_large"
        | "unsupported_activity";
    };

/**
 * Valide le jeton de service Bot Framework avec le SDK Teams officiel, puis
 * projette uniquement les champs nécessaires à la future ingestion canonique.
 * Aucun payload brut, nom de personne ou URL de pièce jointe n'est retourné.
 */
export async function verifyAndPrepareTeamsActivity(
  input: {
    authorization: string | undefined;
    rawBody: string;
  },
  configuration: {
    clientId: string | undefined;
    tenantId: string | undefined;
    createValidator?: (
      clientId: string,
      tenantId: string,
    ) => TeamsServiceTokenValidator;
  },
): Promise<TeamsWebhookVerificationResult> {
  if (Buffer.byteLength(input.rawBody, "utf8") > maxTeamsWebhookBytes) {
    return { ok: false, code: "payload_too_large" };
  }

  const authorization = input.authorization?.trim();
  if (!authorization || !/^Bearer [A-Za-z0-9._~-]+$/.test(authorization)) {
    return { ok: false, code: "invalid_authorization" };
  }

  const clientId = uuidSchema.safeParse(configuration.clientId);
  const tenantId = uuidSchema.safeParse(configuration.tenantId);
  if (!clientId.success || !tenantId.success) {
    return { ok: false, code: "invalid_authorization" };
  }

  let rawActivity: unknown;
  try {
    rawActivity = JSON.parse(input.rawBody);
  } catch {
    return { ok: false, code: "invalid_activity" };
  }

  const activity = teamsActivityProjectionSchema.safeParse(rawActivity);
  if (!activity.success) {
    return { ok: false, code: "invalid_activity" };
  }

  const createValidator =
    configuration.createValidator ?? createOfficialTeamsValidator;
  try {
    await createValidator(clientId.data, tenantId.data).check(
      authorization,
      rawActivity,
    );
  } catch {
    return { ok: false, code: "invalid_authorization" };
  }

  if (activity.data.type !== "message") {
    return { ok: false, code: "unsupported_activity" };
  }

  const text = activity.data.text?.trim() || undefined;
  const attachmentCount = activity.data.attachments?.length ?? 0;
  if (!text && attachmentCount === 0) {
    return { ok: false, code: "invalid_activity" };
  }

  const eventFingerprint = fingerprintTeamsEvent(activity.data.id);
  return {
    ok: true,
    message: preparedTeamsInboundMessageSchema.parse({
      provider: "teams_microsoft",
      adapterKey: "teams-microsoft",
      externalMessageId: activity.data.id,
      microsoftTenantId: activity.data.channelData.tenant.id,
      senderSubject: activity.data.from.id,
      recipientSubject: activity.data.recipient.id,
      conversationSubject: activity.data.conversation.id,
      ...(text ? { text } : {}),
      attachmentCount,
      idempotencyKey: `ingress:teams_microsoft:${eventFingerprint}`,
      correlationId: `teams_${eventFingerprint}`,
      receivedAt: activity.data.timestamp,
    }),
  };
}

function fingerprintTeamsEvent(externalMessageId: string) {
  return createHash("sha256").update(externalMessageId).digest("hex");
}

function createOfficialTeamsValidator(clientId: string, tenantId: string) {
  return new ServiceTokenValidator(
    clientId,
    tenantId,
    undefined,
    silentTeamsLogger,
  );
}

const silentTeamsLogger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  trace() {},
  log() {},
  child() {
    return silentTeamsLogger;
  },
};

function isSafeHttpsUrl(value: string) {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      Boolean(url.hostname) &&
      !url.username &&
      !url.password &&
      !url.hash
    );
  } catch {
    return false;
  }
}
