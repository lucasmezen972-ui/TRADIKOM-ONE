export type ConversationPlanReceipt =
  | "clarification"
  | "cree"
  | "revised"
  | "delegated"
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
  delegation?: {
    id: string;
    version: number;
    delegatedToUserId: string;
  } | null;
  plan?: { missingContextQuestions: readonly string[] };
};

export function resolveConversationPlanReceipt(
  requestedReceipt: ConversationPlanReceipt | undefined,
  requestedPlanId: string | undefined,
  currentPlan: ConversationPlanReceiptState | undefined,
  requestedDelegationId?: string,
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
    !currentPlan.delegation &&
    !currentPlan.mission
  ) {
    return requestedReceipt;
  }
  if (
    requestedReceipt === "cree" &&
    currentPlan.approvalStatus === "awaiting_approval" &&
    !currentPlan.supersedesPlanId &&
    !currentPlan.delegation &&
    !currentPlan.mission
  ) {
    return requestedReceipt;
  }
  if (
    requestedReceipt === "delegated" &&
    currentPlan.approvalStatus === "awaiting_approval" &&
    Boolean(requestedDelegationId) &&
    currentPlan.delegation?.id === requestedDelegationId &&
    Boolean(currentPlan.delegation?.delegatedToUserId) &&
    (currentPlan.delegation?.version ?? 0) >= 1 &&
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
    delegated:
      "Décision déléguée. Le plan reste en attente de validation et aucune action n’a été exécutée.",
    approved: "Plan approuvé. Il est prêt pour l’exécution mock.",
    rejected: "Plan annulé. Aucune action n’a été exécutée.",
    executed: "Exécution mock terminée et preuve durable enregistrée.",
  }[receipt];
}
