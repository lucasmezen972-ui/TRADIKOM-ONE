export type ConversationPlanReceipt =
  | "cree"
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
    requestedReceipt === "cree" &&
    currentPlan.approvalStatus === "awaiting_approval" &&
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
    cree: "Plan déterministe créé et placé en attente de validation.",
    approved: "Plan approuvé. Il est prêt pour l’exécution mock.",
    rejected: "Plan refusé. Aucune action n’a été exécutée.",
    executed: "Exécution mock terminée et preuve durable enregistrée.",
  }[receipt];
}
