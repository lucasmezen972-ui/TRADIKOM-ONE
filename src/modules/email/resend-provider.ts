import { hashToken } from "@/lib/security";
import { emailAddressSchema } from "@/modules/email/schemas";
import type {
  EmailDeliveryOutcome,
  EmailMessage,
  EmailProvider,
} from "@/modules/email/types";

const resendApiUrl = "https://api.resend.com/emails";
const defaultTimeoutMs = 10_000;
const maxResponseBytes = 8_192;
const maxContentBytes = 2 * 1024 * 1024;

export type ResendEmailProviderConfig = {
  apiKey: string;
  from: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export function createResendEmailProvider(
  config: ResendEmailProviderConfig,
): EmailProvider {
  const prepared = prepareConfig(config);

  return {
    name: "resend",
    async send(message): Promise<EmailDeliveryOutcome> {
      if (!isBoundedMessage(message)) {
        return permanentFailure("message_invalid");
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), prepared.timeoutMs);

      try {
        const response = await prepared.fetchImpl(resendApiUrl, {
          method: "POST",
          headers: {
            authorization: `Bearer ${prepared.apiKey}`,
            "content-type": "application/json",
            "idempotency-key": idempotencyKey(message),
            "user-agent": "tradikom-one/1.0",
          },
          body: JSON.stringify({
            from: prepared.from,
            to: [message.to],
            subject: message.subject,
            text: message.text,
            html: message.html,
            tags: resendTags(message),
          }),
          signal: controller.signal,
          redirect: "error",
        });

        return classifyResponse(response, await readBoundedBody(response));
      } catch {
        return retryableFailure("network_error", 300);
      } finally {
        clearTimeout(timeout);
      }
    },
  };
}

function prepareConfig(config: ResendEmailProviderConfig) {
  const apiKey = config.apiKey.trim();
  const from = config.from.trim();
  const timeoutMs = config.timeoutMs ?? defaultTimeoutMs;

  if (
    !apiKey ||
    !from ||
    from.length > 320 ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 10 ||
    timeoutMs > 30_000
  ) {
    throw new Error("Configuration du provider email invalide.");
  }

  return {
    apiKey,
    from,
    timeoutMs,
    fetchImpl: config.fetchImpl ?? fetch,
  };
}

function isBoundedMessage(message: EmailMessage) {
  const encoder = new TextEncoder();
  const contentBytes = encoder.encode(
    `${message.subject}\n${message.text}\n${message.html}`,
  ).byteLength;

  return (
    emailAddressSchema.safeParse(message.to).success &&
    message.to.length <= 320 &&
    message.subject.length > 0 &&
    message.subject.length <= 998 &&
    contentBytes <= maxContentBytes &&
    message.metadata.expiresAt.length <= 64 &&
    (!message.metadata.tenantId ||
      /^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(message.metadata.tenantId)) &&
    (message.metadata.invitationId?.length ?? 0) <= 160
  );
}

function resendTags(message: EmailMessage) {
  return [
    { name: "tradikom_kind", value: message.kind },
    ...(message.metadata.tenantId
      ? [{ name: "tradikom_tenant", value: message.metadata.tenantId }]
      : []),
  ];
}

function classifyResponse(
  response: Response,
  body: string,
): EmailDeliveryOutcome {
  if (response.ok) {
    return {
      status: "sent",
      provider: "resend",
      messageId: extractMessageId(body),
    };
  }

  const providerError = extractProviderError(body);

  if (
    response.status === 409 &&
    providerError === "concurrent_idempotent_requests"
  ) {
    return retryableFailure("concurrent_request", 10);
  }

  if (response.status === 429) {
    return retryableFailure(
      providerError === "daily_quota_exceeded" ||
        providerError === "monthly_quota_exceeded"
        ? "provider_quota_exceeded"
        : "rate_limited",
      retryAfterSeconds(response) ?? 60,
    );
  }

  if (response.status >= 500) {
    return retryableFailure(
      "provider_unavailable",
      retryAfterSeconds(response) ?? 300,
    );
  }

  if (
    response.status === 401 ||
    (response.status === 403 && providerError === "invalid_api_key")
  ) {
    return permanentFailure("provider_unauthorized");
  }

  if (response.status === 409) {
    return permanentFailure("idempotency_conflict");
  }

  return permanentFailure("message_rejected");
}

async function readBoundedBody(response: Response) {
  const reader = response.body?.getReader();
  if (!reader) return "";

  const chunks: Uint8Array[] = [];
  let receivedBytes = 0;

  try {
    while (receivedBytes < maxResponseBytes) {
      const { done, value } = await reader.read();
      if (done) break;

      const remainingBytes = maxResponseBytes - receivedBytes;
      const boundedChunk = value.subarray(0, remainingBytes);
      chunks.push(boundedChunk);
      receivedBytes += boundedChunk.byteLength;

      if (receivedBytes >= maxResponseBytes) {
        await reader.cancel();
        break;
      }
    }
  } catch {
    return "";
  } finally {
    reader.releaseLock();
  }

  const merged = new Uint8Array(receivedBytes);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(merged);
}

function extractMessageId(body: string) {
  const value = extractStringProperty(body, "id");
  return value && value.length <= 256 ? value : undefined;
}

function extractProviderError(body: string) {
  const name = extractStringProperty(body, "name");
  return name && name.length <= 80 ? name : undefined;
}

function extractStringProperty(body: string, property: string) {
  try {
    const parsed: unknown = JSON.parse(body);
    if (
      parsed &&
      typeof parsed === "object" &&
      property in parsed &&
      typeof (parsed as Record<string, unknown>)[property] === "string"
    ) {
      return (parsed as Record<string, string>)[property];
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function retryAfterSeconds(response: Response) {
  const value = response.headers.get("retry-after");
  if (!value) return undefined;

  const seconds = Number.parseInt(value, 10);
  return Number.isFinite(seconds) && seconds > 0 && seconds <= 86_400
    ? seconds
    : undefined;
}

function idempotencyKey(message: EmailMessage) {
  const fingerprint = hashToken(
    JSON.stringify([
      message.kind,
      message.to,
      message.subject,
      message.text,
      message.html,
      message.metadata.expiresAt,
      message.metadata.tenantId ?? null,
      message.metadata.invitationId ?? null,
    ]),
  );
  return `tradikom-one-email-v1/${fingerprint}`;
}

function retryableFailure(
  errorCode: string,
  retryAfterSeconds: number,
): EmailDeliveryOutcome {
  return {
    status: "retryable_failure",
    provider: "resend",
    errorCode,
    retryAfterSeconds,
  };
}

function permanentFailure(errorCode: string): EmailDeliveryOutcome {
  return {
    status: "permanent_failure",
    provider: "resend",
    errorCode,
  };
}
