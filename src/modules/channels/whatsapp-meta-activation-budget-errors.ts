export type WhatsAppMetaActivationBudgetErrorCode =
  | "channel_provider_activation_budget_access_denied"
  | "channel_provider_activation_budget_exhausted"
  | "channel_provider_activation_budget_invalid";

export class WhatsAppMetaActivationBudgetError extends Error {
  constructor(
    public readonly code: WhatsAppMetaActivationBudgetErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WhatsAppMetaActivationBudgetError";
  }
}
