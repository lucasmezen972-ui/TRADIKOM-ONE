import { Buffer } from "node:buffer";
import { ServiceTokenValidator } from "@microsoft/teams.apps/dist/middleware";
import { z } from "zod";

const maxTeamsWebhookBytes = 1024 * 1024;
const uuidSchema = z.string().uuid();
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

export type PreparedTeamsInboundMessage = {
  provider: "teams_microsoft";
  adapterKey: "teams-microsoft";
  externalMessageId: string;
  microsoftTenantId: string;
  senderSubject: string;
  recipientSubject: string;
  conversationSubject: string;
  text?: string;
  attachmentCount: number;
  idempotencyKey: string;
  correlationId: string;
  receivedAt: string;
};

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

  return {
    ok: true,
    message: {
      provider: "teams_microsoft",
      adapterKey: "teams-microsoft",
      externalMessageId: activity.data.id,
      microsoftTenantId: activity.data.channelData.tenant.id,
      senderSubject: activity.data.from.id,
      recipientSubject: activity.data.recipient.id,
      conversationSubject: activity.data.conversation.id,
      ...(text ? { text } : {}),
      attachmentCount,
      idempotencyKey: `ingress:teams_microsoft:${activity.data.id}`,
      correlationId: `teams_${activity.data.id}`,
      receivedAt: activity.data.timestamp,
    },
  };
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

