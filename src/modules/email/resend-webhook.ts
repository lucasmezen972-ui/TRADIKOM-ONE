import { Webhook } from "svix";
import { z } from "zod";

const maxPayloadBytes = 512 * 1024;

const resendWebhookInputSchema = z
  .object({
    rawBody: z.string().max(maxPayloadBytes),
    headers: z
      .object({
        id: z.string().trim().min(1).max(256),
        timestamp: z.string().trim().min(1).max(32),
        signature: z.string().trim().min(1).max(2_048),
      })
      .strict(),
  })
  .strict();

const supportedEventTypeSchema = z.enum([
  "email.sent",
  "email.delivered",
  "email.delivery_delayed",
  "email.bounced",
  "email.complained",
  "email.failed",
  "email.suppressed",
]);

const providerPayloadSchema = z
  .object({
    type: z.string().trim().min(1).max(80),
    created_at: z.string().datetime({ offset: true }),
    data: z
      .object({
        email_id: z.string().trim().min(1).max(256),
        tags: z
          .record(
            z.string().regex(/^[A-Za-z0-9_-]{1,256}$/),
            z.string().regex(/^[A-Za-z0-9_-]{1,256}$/),
          )
          .optional(),
      })
      .passthrough(),
  })
  .passthrough();

export type SafeResendWebhookEvent = {
  externalEventId: string;
  tenantId: string;
  providerEmailId: string;
  eventType: z.infer<typeof supportedEventTypeSchema>;
  deliveryStatus: "sent" | "delivered" | "delayed" | "failed";
  occurredAt: string;
};

export type ResendWebhookVerificationResult =
  | { ok: true; event: SafeResendWebhookEvent }
  | {
      ok: false;
      code:
        | "not_configured"
        | "invalid_headers"
        | "payload_too_large"
        | "invalid_signature"
        | "payload_invalid"
        | "unsupported_event"
        | "tenant_mapping_missing";
    };

export function verifyResendWebhook(
  input: unknown,
  signingSecret: string | undefined,
): ResendWebhookVerificationResult {
  if (!signingSecret?.trim()) {
    return { ok: false, code: "not_configured" };
  }

  const parsedInput = resendWebhookInputSchema.safeParse(input);
  if (!parsedInput.success) {
    const candidate = input as { rawBody?: unknown } | null;
    if (
      candidate &&
      typeof candidate.rawBody === "string" &&
      new TextEncoder().encode(candidate.rawBody).byteLength > maxPayloadBytes
    ) {
      return { ok: false, code: "payload_too_large" };
    }
    return { ok: false, code: "invalid_headers" };
  }

  if (
    new TextEncoder().encode(parsedInput.data.rawBody).byteLength >
    maxPayloadBytes
  ) {
    return { ok: false, code: "payload_too_large" };
  }

  let verifiedPayload: unknown;
  try {
    verifiedPayload = new Webhook(signingSecret.trim()).verify(
      parsedInput.data.rawBody,
      {
        "svix-id": parsedInput.data.headers.id,
        "svix-timestamp": parsedInput.data.headers.timestamp,
        "svix-signature": parsedInput.data.headers.signature,
      },
    );
  } catch {
    return { ok: false, code: "invalid_signature" };
  }

  const parsedPayload = providerPayloadSchema.safeParse(verifiedPayload);
  if (!parsedPayload.success) {
    return { ok: false, code: "payload_invalid" };
  }

  const eventType = supportedEventTypeSchema.safeParse(
    parsedPayload.data.type,
  );
  if (!eventType.success) {
    return { ok: false, code: "unsupported_event" };
  }

  const tenantId = parsedPayload.data.data.tags?.tradikom_tenant;
  if (!tenantId || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(tenantId)) {
    return { ok: false, code: "tenant_mapping_missing" };
  }

  return {
    ok: true,
    event: {
      externalEventId: parsedInput.data.headers.id,
      tenantId,
      providerEmailId: parsedPayload.data.data.email_id,
      eventType: eventType.data,
      deliveryStatus: deliveryStatus(eventType.data),
      occurredAt: parsedPayload.data.created_at,
    },
  };
}

function deliveryStatus(
  eventType: z.infer<typeof supportedEventTypeSchema>,
): SafeResendWebhookEvent["deliveryStatus"] {
  if (eventType === "email.sent") return "sent";
  if (eventType === "email.delivered") return "delivered";
  if (eventType === "email.delivery_delayed") return "delayed";
  return "failed";
}
