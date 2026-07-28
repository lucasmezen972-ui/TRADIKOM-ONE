import type {
  EmailDeliveryOutcome,
  EmailMessage,
  EmailProvider,
} from "@/modules/email/types";

/**
 * Origine fixe du fournisseur. Elle n'est jamais lue depuis l'environnement :
 * une URL configurable ouvrirait une surface SSRF sur un chemin qui porte une
 * clé d'API en en-tête.
 */
const resendApiUrl = "https://api.resend.com/emails";
const defaultTimeoutMs = 10_000;
const maxResponseBytes = 8_192;

export type ResendEmailProviderConfig = {
  apiKey: string;
  from: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export function createResendEmailProvider(
  config: ResendEmailProviderConfig,
): EmailProvider {
  const timeoutMs = config.timeoutMs ?? defaultTimeoutMs;
  const fetchImpl = config.fetchImpl ?? fetch;

  return {
    name: "resend",
    async send(message: EmailMessage): Promise<EmailDeliveryOutcome> {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetchImpl(resendApiUrl, {
          method: "POST",
          headers: {
            authorization: `Bearer ${config.apiKey}`,
            "content-type": "application/json",
            "idempotency-key": idempotencyKey(message),
          },
          body: JSON.stringify({
            from: config.from,
            to: [message.to],
            subject: message.subject,
            text: message.text,
            html: message.html,
          }),
          signal: controller.signal,
          redirect: "error",
        });

        return classifyResponse(response, await readBoundedBody(response));
      } catch {
        // Le corps de l'erreur réseau n'est jamais propagé : il peut contenir
        // l'adresse du destinataire ou des fragments d'en-tête.
        return {
          status: "retryable_failure",
          provider: "resend",
          errorCode: "network_error",
          retryAfterSeconds: 300,
        };
      } finally {
        clearTimeout(timeout);
      }
    },
  };
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

  if (response.status === 429) {
    return {
      status: "retryable_failure",
      provider: "resend",
      errorCode: "rate_limited",
      retryAfterSeconds: retryAfterSeconds(response) ?? 60,
    };
  }

  if (response.status >= 500) {
    return {
      status: "retryable_failure",
      provider: "resend",
      errorCode: "provider_unavailable",
      retryAfterSeconds: retryAfterSeconds(response) ?? 300,
    };
  }

  if (response.status === 401 || response.status === 403) {
    // Une clé invalide ou révoquée ne se répare pas en réessayant.
    return {
      status: "permanent_failure",
      provider: "resend",
      errorCode: "provider_unauthorized",
    };
  }

  return {
    status: "permanent_failure",
    provider: "resend",
    errorCode: "message_rejected",
  };
}

async function readBoundedBody(response: Response) {
  try {
    const text = await response.text();
    return text.slice(0, maxResponseBytes);
  } catch {
    return "";
  }
}

function extractMessageId(body: string) {
  try {
    const parsed: unknown = JSON.parse(body);
    if (
      parsed &&
      typeof parsed === "object" &&
      "id" in parsed &&
      typeof (parsed as { id: unknown }).id === "string"
    ) {
      return (parsed as { id: string }).id;
    }
  } catch {
    // Une réponse non-JSON reste un succès : l'identifiant est simplement absent.
  }
  return undefined;
}

function retryAfterSeconds(response: Response) {
  const header = response.headers.get("retry-after");
  if (!header) {
    return undefined;
  }
  const seconds = Number.parseInt(header, 10);
  return Number.isFinite(seconds) && seconds > 0 && seconds <= 86_400
    ? seconds
    : undefined;
}

function idempotencyKey(message: EmailMessage) {
  // Un même lien, avec la même expiration, ne doit pas partir deux fois si une
  // reprise du worker rejoue la livraison.
  return `${message.kind}:${message.metadata.invitationId ?? "none"}:${message.metadata.expiresAt}`;
}
