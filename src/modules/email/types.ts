export type EmailKind = "password_reset" | "team_invitation";

export type EmailMessage = {
  kind: EmailKind;
  to: string;
  subject: string;
  text: string;
  html: string;
  metadata: {
    expiresAt: string;
    tenantId?: string;
    invitationId?: string;
  };
};

export type EmailDeliveryStatus =
  | "sent"
  | "retryable_failure"
  | "permanent_failure";

export type EmailDeliveryOutcome = {
  status: EmailDeliveryStatus;
  provider: string;
  messageId?: string;
  errorCode?: string;
  retryAfterSeconds?: number;
};

export type EmailProvider = {
  readonly name: string;
  send(message: EmailMessage): Promise<EmailDeliveryOutcome>;
};
