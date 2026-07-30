import {
  validateRequest,
  validateRequestWithBody,
} from "twilio";
import { z } from "zod";

const maxPayloadBytes = 512 * 1024;
const maxFormParameters = 128;
const maxParameterNameLength = 160;
const maxParameterValueLength = 64 * 1024;

const twilioWebhookInputSchema = z
  .object({
    url: z.string().trim().min(1).max(2_048),
    contentType: z.string().trim().min(1).max(160),
    rawBody: z.string(),
    signature: z.string().trim().min(1).max(512),
  })
  .strict();

const safeTwilioSidSchema = z
  .string()
  .trim()
  .regex(/^[A-Z]{2}[a-fA-F0-9]{32}$/);

type TwilioFormParameters = Record<string, string | string[]>;

export type SafeVerifiedTwilioWebhook = {
  signatureVerified: true;
  payloadKind: "form" | "json";
  externalEventId?: string;
  safeAccountReference?: string;
  parameterCount?: number;
};

export type TwilioWebhookVerificationResult =
  | { ok: true; event: SafeVerifiedTwilioWebhook }
  | {
      ok: false;
      code:
        | "not_configured"
        | "payload_too_large"
        | "unsupported_content_type"
        | "url_invalid"
        | "payload_invalid"
        | "invalid_signature";
    };

/**
 * Vérifie un webhook Twilio avec le SDK officiel sans exposer son contenu.
 * L'URL est transmise au SDK telle que reçue : elle ne doit jamais être
 * reconstruite depuis des en-têtes proxy après cet appel.
 */
export function verifyTwilioWebhook(
  input: unknown,
  authToken: string | undefined,
): TwilioWebhookVerificationResult {
  if (!authToken?.trim()) {
    return { ok: false, code: "not_configured" };
  }

  const parsedInput = twilioWebhookInputSchema.safeParse(input);
  if (!parsedInput.success) {
    return { ok: false, code: "payload_invalid" };
  }

  const rawBodyBytes = new TextEncoder().encode(
    parsedInput.data.rawBody,
  ).byteLength;
  if (rawBodyBytes > maxPayloadBytes) {
    return { ok: false, code: "payload_too_large" };
  }

  if (!isAcceptedWebhookUrl(parsedInput.data.url)) {
    return { ok: false, code: "url_invalid" };
  }

  const mediaType = parsedInput.data.contentType
    .split(";", 1)[0]
    ?.trim()
    .toLowerCase();

  if (mediaType === "application/x-www-form-urlencoded") {
    const parsedForm = parseBoundedFormBody(parsedInput.data.rawBody);
    if (!parsedForm) {
      return { ok: false, code: "payload_invalid" };
    }

    if (
      !validateRequest(
        authToken.trim(),
        parsedInput.data.signature,
        parsedInput.data.url,
        parsedForm.parameters,
      )
    ) {
      return { ok: false, code: "invalid_signature" };
    }

    return {
      ok: true,
      event: {
        signatureVerified: true,
        payloadKind: "form",
        externalEventId: firstSafeSid(parsedForm.parameters, [
          "MessageSid",
          "SmsSid",
        ]),
        safeAccountReference: firstSafeSid(parsedForm.parameters, [
          "AccountSid",
        ]),
        parameterCount: parsedForm.parameterCount,
      },
    };
  }

  if (mediaType === "application/json") {
    if (
      !validateRequestWithBody(
        authToken.trim(),
        parsedInput.data.signature,
        parsedInput.data.url,
        parsedInput.data.rawBody,
      )
    ) {
      return { ok: false, code: "invalid_signature" };
    }

    return {
      ok: true,
      event: {
        signatureVerified: true,
        payloadKind: "json",
      },
    };
  }

  return { ok: false, code: "unsupported_content_type" };
}

function isAcceptedWebhookUrl(value: string) {
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

function parseBoundedFormBody(rawBody: string): {
  parameters: TwilioFormParameters;
  parameterCount: number;
} | null {
  const searchParameters = new URLSearchParams(rawBody);
  const parameters: TwilioFormParameters = Object.create(null) as TwilioFormParameters;
  let parameterCount = 0;

  for (const [name, value] of searchParameters) {
    parameterCount += 1;
    if (
      parameterCount > maxFormParameters ||
      name.length === 0 ||
      name.length > maxParameterNameLength ||
      value.length > maxParameterValueLength
    ) {
      return null;
    }

    const previous = parameters[name];
    if (previous === undefined) {
      parameters[name] = value;
    } else if (Array.isArray(previous)) {
      previous.push(value);
    } else {
      parameters[name] = [previous, value];
    }
  }

  return { parameters, parameterCount };
}

function firstSafeSid(
  parameters: TwilioFormParameters,
  names: string[],
): string | undefined {
  for (const name of names) {
    const candidate = parameters[name];
    const value = Array.isArray(candidate) ? candidate[0] : candidate;
    const parsed = safeTwilioSidSchema.safeParse(value);
    if (parsed.success) return parsed.data;
  }
  return undefined;
}
