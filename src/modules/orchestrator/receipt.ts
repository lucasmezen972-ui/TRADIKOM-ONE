export type ConversationPlanReceipt =
  | "clarification"
  | "cree"
  | "revised"
  | "approved"
  | "rejected"
  | "executed";

export type ConversationPlanReceiptState = {
  id: string;
  approvalStatus:
    | "draft"
    | "awaiting_approval"
    | "approved"
    | "rejected"
    | "executed";
  mission?: { status: string } | null;
  supersedesPlanId?: string | null;
  plan?: { missingContextQuestions: readonly string[] };
};

export function resolveConversationPlanReceipt(
  requestedReceipt: ConversationPlanReceipt | undefined,
  requestedPlanId: string | undefined,
  currentPlan: ConversationPlanReceiptState | undefined,
): ConversationPlanReceipt | null {
  if (
    !requestedReceipt ||
    !requestedPlanId ||
    !currentPlan ||
    currentPlan.id !== requestedPlanId
  ) {
    return null;
  }
  if (
    requestedReceipt === "clarification" &&
    currentPlan.approvalStatus === "draft" &&
    Boolean(currentPlan.plan?.missingContextQuestions.length) &&
    !currentPlan.supersedesPlanId &&
    !currentPlan.mission
  ) {
    return requestedReceipt;
  }
  if (
    requestedReceipt === "revised" &&
    currentPlan.approvalStatus === "awaiting_approval" &&
    currentPlan.supersedesPlanId &&
    !currentPlan.mission
  ) {
    return requestedReceipt;
  }
  if (
    requestedReceipt === "cree" &&
    currentPlan.approvalStatus === "awaiting_approval" &&
    !currentPlan.supersedesPlanId &&
    !currentPlan.mission
  ) {
    return requestedReceipt;
  }
  if (
    requestedReceipt === "approved" &&
    currentPlan.approvalStatus === "approved" &&
    !currentPlan.mission
  ) {
    return requestedReceipt;
  }
  if (
    requestedReceipt === "rejected" &&
    currentPlan.approvalStatus === "rejected" &&
    !currentPlan.mission
  ) {
    return requestedReceipt;
  }
  if (
    requestedReceipt === "executed" &&
    currentPlan.approvalStatus === "executed" &&
    currentPlan.mission?.status === "succeeded"
  ) {
    return requestedReceipt;
  }
  return null;
}

export function planReceiptMessage(receipt: ConversationPlanReceipt) {
  return {
    clarification:
      "Une précision est nécessaire avant de préparer ce plan. Aucune action n’a été exécutée.",
    cree: "Plan déterministe créé et placé en attente de validation.",
    revised: "Nouvelle version du plan créée et placée en attente de validation.",
    approved: "Plan approuvé. Il est prêt pour l’exécution mock.",
    rejected: "Plan annulé. Aucune action n’a été exécutée.",
    executed: "Exécution mock terminée et preuve durable enregistrée.",
  }[receipt];
}
