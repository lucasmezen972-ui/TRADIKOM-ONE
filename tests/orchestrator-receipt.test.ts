import { describe, expect, it } from "vitest";
import { resolveConversationPlanReceipt } from "../src/modules/orchestrator";

describe("reçu durable d’un plan Conversation", () => {
  it("refuse un reçu sans identifiant exact ou avec un état incohérent", () => {
    const rejectedPlan = {
      id: "plan_rejected",
      approvalStatus: "rejected" as const,
      mission: null,
    };

    expect(
      resolveConversationPlanReceipt("executed", undefined, rejectedPlan),
    ).toBeNull();
    expect(
      resolveConversationPlanReceipt(
        "executed",
        "plan_rejected",
        rejectedPlan,
      ),
    ).toBeNull();
    expect(
      resolveConversationPlanReceipt(
        "rejected",
        "plan_different",
        rejectedPlan,
      ),
    ).toBeNull();
  });

  it("reconnaît uniquement les quatre états durables correspondants", () => {
    expect(
      resolveConversationPlanReceipt("cree", "plan_created", {
        id: "plan_created",
        approvalStatus: "awaiting_approval",
      }),
    ).toBe("cree");
    expect(
      resolveConversationPlanReceipt("approved", "plan_approved", {
        id: "plan_approved",
        approvalStatus: "approved",
      }),
    ).toBe("approved");
    expect(
      resolveConversationPlanReceipt("rejected", "plan_rejected", {
        id: "plan_rejected",
        approvalStatus: "rejected",
      }),
    ).toBe("rejected");
    expect(
      resolveConversationPlanReceipt("executed", "plan_executed", {
        id: "plan_executed",
        approvalStatus: "executed",
        mission: { status: "succeeded" },
      }),
    ).toBe("executed");
  });

  it("n’atteste jamais une exécution sans mission durable réussie", () => {
    for (const status of [undefined, "running", "failed"] as const) {
      expect(
        resolveConversationPlanReceipt("executed", "plan_executed", {
          id: "plan_executed",
          approvalStatus: "executed",
          ...(status ? { mission: { status } } : {}),
        }),
      ).toBeNull();
    }
  });

  it("n’affiche jamais un reçu de préparation, approbation ou refus après le démarrage d’une mission", () => {
    for (const [receipt, approvalStatus] of [
      ["cree", "awaiting_approval"],
      ["approved", "approved"],
      ["rejected", "rejected"],
    ] as const) {
      for (const status of ["running", "failed", "succeeded"] as const) {
        expect(
          resolveConversationPlanReceipt(receipt, `plan_${receipt}`, {
            id: `plan_${receipt}`,
            approvalStatus,
            mission: { status },
          }),
        ).toBeNull();
      }
    }
  });
});
