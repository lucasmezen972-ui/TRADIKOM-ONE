import { hashToken } from "@/lib/security";
import type {
  EmailDeliveryOutcome,
  EmailMessage,
  EmailProvider,
} from "@/modules/email/types";

type SafeLogger = (event: string, metadata: Record<string, unknown>) => void;

export function createConsoleEmailProvider(
  logger: SafeLogger = (event, metadata) => console.info(event, metadata),
): EmailProvider {
  return {
    name: "console",
    async send(message) {
      logger("email.delivery", {
        kind: message.kind,
        recipientHash: hashToken(message.to),
        expiresAt: message.metadata.expiresAt,
        tenantId: message.metadata.tenantId,
        invitationId: message.metadata.invitationId,
        status: "sent",
      });

      return {
        status: "sent",
        provider: "console",
        messageId: `console_${hashToken(`${message.kind}:${message.to}:${message.metadata.expiresAt}`).slice(0, 20)}`,
      };
    },
  };
}

export type TestEmailProvider = EmailProvider & {
  readonly messages: EmailMessage[];
  queueOutcome(outcome: Omit<EmailDeliveryOutcome, "provider">): void;
};

export function createTestEmailProvider(
  initialOutcomes: Array<Omit<EmailDeliveryOutcome, "provider">> = [],
): TestEmailProvider {
  const messages: EmailMessage[] = [];
  const outcomes = [...initialOutcomes];

  return {
    name: "test",
    messages,
    queueOutcome(outcome) {
      outcomes.push(outcome);
    },
    async send(message) {
      messages.push(structuredClone(message));
      const outcome = outcomes.shift();
      return {
        status: outcome?.status ?? "sent",
        provider: "test",
        messageId: outcome?.messageId ?? `test_${messages.length}`,
        errorCode: outcome?.errorCode,
        retryAfterSeconds: outcome?.retryAfterSeconds,
      };
    },
  };
}

export function createUnavailableEmailProvider(): EmailProvider {
  return {
    name: "unavailable",
    async send() {
      return {
        status: "retryable_failure",
        provider: "unavailable",
        errorCode: "provider_not_configured",
        retryAfterSeconds: 300,
      };
    },
  };
}

export function createRuntimeEmailProvider(): EmailProvider {
  const selected = process.env.EMAIL_PROVIDER?.trim().toLowerCase();
  const consoleAllowedInProduction =
    process.env.ALLOW_CONSOLE_EMAIL_IN_PRODUCTION === "true";

  if (
    process.env.NODE_ENV !== "production" ||
    (selected === "console" && consoleAllowedInProduction)
  ) {
    return createConsoleEmailProvider();
  }

  return createUnavailableEmailProvider();
}
