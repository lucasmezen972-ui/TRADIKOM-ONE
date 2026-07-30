import { Buffer } from "node:buffer";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";

const maxSlackWebhookBytes = 1024 * 1024;
const slackSigningSecretSchema = z.string().min(16).max(512);
const slackId = (prefix: string, max = 64) =>
  z
    .string()
    .trim()
    .min(prefix.length + 8)
    .max(max)
    .regex(new RegExp(`^${prefix}[A-Z0-9]+$`));
const slackTimestampSchema = z.string().regex(/^\d{1,12}$/);
const slackMessageTimestampSchema = z.string().regex(/^\d{1,12}\.\d{6}$/);

const slackUrlVerificationSchema = z.object({
  type: z.literal("url_verification"),
  challenge: z.string().trim().min(1).max(256),
});

const slackEventCallbackSchema = z.object({
  type: z.literal("event_callback"),
  team_id: slackId("T"),
  api_app_id: slackId("A"),
  event_id: slackId("Ev", 128),
  event_time: z.number().int().nonnegative(),
  event: z.object({
    type: z.literal("message"),
    subtype: z.string().max(80).optional(),
    bot_id: slackId("B").optional(),
    user: slackId("U"),
    channel: z.string().trim().min(9).max(64).regex(/^[CDG][A-Z0-9]+$/),
    channel_type: z.enum(["channel", "group", "im", "mpim"]).optional(),
    text: z.string().max(40_000).optional(),
    ts: slackMessageTimestampSchema,
    thread_ts: slackMessageTimestampSchema.optional(),
    files: z.array(z.unknown()).max(10).optional(),
  }),
});

export const preparedSlackInboundMessageSchema = z
  .object({
    provider: z.literal("slack"),
    adapterKey: z.literal("slack"),
    externalEventId: slackId("Ev", 128),
    appId: slackId("A"),
    workspaceId: slackId("T"),
    senderSubject: slackId("U"),
    conversationSubject: z.string().trim().min(1).max(160),
    text: z.string().trim().min(1).max(40_000).optional(),
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
    const eventFingerprint = fingerprintSlackEvent(message.externalEventId);
    if (message.idempotencyKey !== `ingress:slack:${eventFingerprint}`) {
      context.addIssue({
        code: "custom",
        path: ["idempotencyKey"],
        message: "La clé d'idempotence Slack ne correspond pas à l'événement.",
      });
    }
    if (message.correlationId !== `slack_${eventFingerprint}`) {
      context.addIssue({
        code: "custom",
        path: ["correlationId"],
        message: "La corrélation Slack ne correspond pas à l'événement.",
      });
    }
  });

export type PreparedSlackInboundMessage = z.infer<
  typeof preparedSlackInboundMessageSchema
>;

export type SlackWebhookVerificationResult =
  | { ok: true; kind: "event"; message: PreparedSlackInboundMessage }
  | { ok: true; kind: "url_verification"; challenge: string }
  | {
      ok: false;
      code:
        | "invalid_signature"
        | "replay_window_exceeded"
        | "payload_too_large"
        | "invalid_payload"
        | "unsupported_event";
    };

/** Vérifie la recette v0 officielle Slack sur le corps brut avant parsing. */
export function verifyAndPrepareSlackWebhook(
  input: {
    rawBody: string;
    signature: string | undefined;
    requestTimestamp: string | undefined;
  },
  configuration: {
    signingSecret: string | undefined;
    nowEpochSeconds?: number;
  },
): SlackWebhookVerificationResult {
  if (Buffer.byteLength(input.rawBody, "utf8") > maxSlackWebhookBytes) {
    return { ok: false, code: "payload_too_large" };
  }

  const secret = slackSigningSecretSchema.safeParse(
    configuration.signingSecret,
  );
  const timestamp = slackTimestampSchema.safeParse(input.requestTimestamp);
  const signature = z
    .string()
    .regex(/^v0=[a-f0-9]{64}$/)
    .safeParse(input.signature);
  if (!secret.success || !timestamp.success || !signature.success) {
    return { ok: false, code: "invalid_signature" };
  }

  const timestampSeconds = Number(timestamp.data);
  const nowSeconds = Math.floor(configuration.nowEpochSeconds ?? Date.now() / 1000);
  if (
    !Number.isSafeInteger(timestampSeconds) ||
    Math.abs(nowSeconds - timestampSeconds) > 5 * 60
  ) {
    return { ok: false, code: "replay_window_exceeded" };
  }

  const expected = `v0=${createHmac("sha256", secret.data)
    .update(`v0:${timestamp.data}:${input.rawBody}`)
    .digest("hex")}`;
  if (!safeEqual(expected, signature.data)) {
    return { ok: false, code: "invalid_signature" };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(input.rawBody);
  } catch {
    return { ok: false, code: "invalid_payload" };
  }

  const urlVerification = slackUrlVerificationSchema.safeParse(payload);
  if (urlVerification.success) {
    return {
      ok: true,
      kind: "url_verification",
      challenge: urlVerification.data.challenge,
    };
  }

  const callback = slackEventCallbackSchema.safeParse(payload);
  if (!callback.success) return { ok: false, code: "invalid_payload" };
  if (callback.data.event.subtype || callback.data.event.bot_id) {
    return { ok: false, code: "unsupported_event" };
  }

  const text = callback.data.event.text?.trim() || undefined;
  const attachmentCount = callback.data.event.files?.length ?? 0;
  if (!text && attachmentCount === 0) {
    return { ok: false, code: "unsupported_event" };
  }

  const eventFingerprint = fingerprintSlackEvent(callback.data.event_id);
  const eventTimestamp = parseSlackTimestamp(callback.data.event.ts);
  if (
    !eventTimestamp ||
    eventTimestamp.epochSeconds > timestampSeconds + 5 * 60
  ) {
    return { ok: false, code: "invalid_payload" };
  }
  const conversationSubject =
    callback.data.event.channel_type === "im"
      ? callback.data.event.channel
      : `${callback.data.event.channel}:${
          callback.data.event.thread_ts ?? callback.data.event.ts
        }`;

  return {
    ok: true,
    kind: "event",
    message: preparedSlackInboundMessageSchema.parse({
      provider: "slack",
      adapterKey: "slack",
      externalEventId: callback.data.event_id,
      appId: callback.data.api_app_id,
      workspaceId: callback.data.team_id,
      senderSubject: callback.data.event.user,
      conversationSubject,
      ...(text ? { text } : {}),
      attachmentCount,
      idempotencyKey: `ingress:slack:${eventFingerprint}`,
      correlationId: `slack_${eventFingerprint}`,
      receivedAt: eventTimestamp.iso,
    }),
  };
}

function fingerprintSlackEvent(eventId: string) {
  return createHash("sha256").update(eventId).digest("hex");
}

function parseSlackTimestamp(value: string) {
  const [seconds, microseconds] = value.split(".");
  const epochSeconds = Number(seconds);
  const milliseconds = Number(microseconds?.slice(0, 3));
  if (!Number.isSafeInteger(epochSeconds) || !Number.isInteger(milliseconds)) {
    return null;
  }
  const date = new Date(epochSeconds * 1000 + milliseconds);
  return Number.isNaN(date.getTime())
    ? null
    : { iso: date.toISOString(), epochSeconds };
}

function safeEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return (
    leftBytes.byteLength === rightBytes.byteLength &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}
