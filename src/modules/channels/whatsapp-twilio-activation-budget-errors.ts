export type WhatsAppTwilioActivationBudgetErrorCode =
  | "channel_provider_activation_budget_access_denied"
  | "channel_provider_activation_budget_exhausted"
  | "channel_provider_activation_budget_invalid";

export class WhatsAppTwilioActivationBudgetError extends Error {
  constructor(
    readonly code: WhatsAppTwilioActivationBudgetErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WhatsAppTwilioActivationBudgetError";
  }
}
