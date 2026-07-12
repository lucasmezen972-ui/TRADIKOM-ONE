import {
  buildInvitationEmail,
  buildPasswordResetEmail,
} from "@/modules/email/templates";
import type { EmailProvider } from "@/modules/email/types";

export async function deliverPasswordResetEmail(
  provider: EmailProvider,
  input: Parameters<typeof buildPasswordResetEmail>[0],
) {
  const message = buildPasswordResetEmail(input);
  const outcome = await sendSafely(provider, message);
  return { outcome, link: message.link };
}

export async function deliverInvitationEmail(
  provider: EmailProvider,
  input: Parameters<typeof buildInvitationEmail>[0],
) {
  const message = buildInvitationEmail(input);
  const outcome = await sendSafely(provider, message);
  return { outcome, link: message.link };
}

export function resolveAppUrl(value = process.env.APP_URL) {
  return new URL(value ?? "http://localhost:3000").origin;
}

export function authLinkPreviewEnabled() {
  return (
    process.env.NODE_ENV !== "production" &&
    process.env.FEATURE_AUTH_LINK_PREVIEW === "true"
  );
}

async function sendSafely(
  provider: EmailProvider,
  message: Parameters<EmailProvider["send"]>[0],
) {
  try {
    return await provider.send(message);
  } catch {
    return {
      status: "retryable_failure" as const,
      provider: provider.name,
      errorCode: "provider_error",
      retryAfterSeconds: 300,
    };
  }
}
