import {
  invitationEmailSchema,
  passwordResetEmailSchema,
  type InvitationEmailInput,
  type PasswordResetEmailInput,
} from "@/modules/email/schemas";
import type { EmailMessage } from "@/modules/email/types";

export function buildPasswordResetEmail(
  input: PasswordResetEmailInput,
): EmailMessage & { link: string } {
  const parsed = passwordResetEmailSchema.parse(input);
  const link = buildTokenLink(parsed.appUrl, "/reinitialiser-mot-de-passe", parsed.token);
  const expiry = formatExpiry(parsed.expiresAt);

  return {
    kind: "password_reset",
    to: parsed.to,
    subject: "Réinitialisez votre mot de passe TRADIKOM ONE",
    text: `Bonjour,\n\nUtilisez ce lien pour réinitialiser votre mot de passe :\n${link}\n\nCe lien expire le ${expiry}. Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.`,
    html: `<p>Bonjour,</p><p>Utilisez le lien ci-dessous pour réinitialiser votre mot de passe.</p><p><a href="${escapeHtml(link)}">Réinitialiser mon mot de passe</a></p><p>Ce lien expire le ${escapeHtml(expiry)}. Si vous n'êtes pas à l'origine de cette demande, ignorez cet e-mail.</p>`,
    metadata: { expiresAt: parsed.expiresAt },
    link,
  };
}

export function buildInvitationEmail(
  input: InvitationEmailInput & { tenantId: string; invitationId: string },
): EmailMessage & { link: string } {
  const parsed = invitationEmailSchema.parse(input);
  const link = buildTokenLink(parsed.appUrl, "/invitation", parsed.token);
  const expiry = formatExpiry(parsed.expiresAt);

  return {
    kind: "team_invitation",
    to: parsed.to,
    subject: `Invitation à rejoindre ${parsed.organizationName}`,
    text: `Bonjour,\n\nVous êtes invité à rejoindre ${parsed.organizationName} avec le rôle ${parsed.roleLabel}.\n${link}\n\nCette invitation expire le ${expiry}.`,
    html: `<p>Bonjour,</p><p>Vous êtes invité à rejoindre <strong>${escapeHtml(parsed.organizationName)}</strong> avec le rôle ${escapeHtml(parsed.roleLabel)}.</p><p><a href="${escapeHtml(link)}">Accepter l'invitation</a></p><p>Cette invitation expire le ${escapeHtml(expiry)}.</p>`,
    metadata: {
      expiresAt: parsed.expiresAt,
      tenantId: input.tenantId,
      invitationId: input.invitationId,
    },
    link,
  };
}

function buildTokenLink(appUrl: string, path: string, token: string) {
  const link = new URL(path, appUrl);
  link.searchParams.set("token", token);
  return link.toString();
}

function formatExpiry(value: string) {
  return new Date(value).toLocaleString("fr-FR", {
    dateStyle: "long",
    timeStyle: "short",
    timeZone: "UTC",
  }) + " UTC";
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
