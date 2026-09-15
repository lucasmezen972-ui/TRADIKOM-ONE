import { describe, expect, it } from "vitest";
import {
  planReceiptMessage,
  resolveConversationPlanReceipt,
} from "../src/modules/orchestrator";

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

  it("reconnaît uniquement les six états durables correspondants", () => {
    expect(
      resolveConversationPlanReceipt("clarification", "plan_clarification", {
        id: "plan_clarification",
        approvalStatus: "draft",
        plan: {
          missingContextQuestions: [
            "Quel résultat métier souhaitez-vous obtenir ?",
          ],
        },
      }),
    ).toBe("clarification");
    expect(
      resolveConversationPlanReceipt("cree", "plan_created", {
        id: "plan_created",
        approvalStatus: "awaiting_approval",
      }),
    ).toBe("cree");
    expect(
      resolveConversationPlanReceipt("revised", "plan_revised", {
        id: "plan_revised",
        approvalStatus: "awaiting_approval",
        supersedesPlanId: "plan_previous",
      }),
    ).toBe("revised");
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

  it("n’atteste une clarification que pour le brouillon exact, sans mission ni parent", () => {
    const draft = {
      id: "plan_clarification",
      approvalStatus: "draft" as const,
      plan: {
        missingContextQuestions: [
          "Quel résultat métier souhaitez-vous obtenir ?",
        ],
      },
    };

    expect(
      resolveConversationPlanReceipt("clarification", undefined, draft),
    ).toBeNull();
    expect(
      resolveConversationPlanReceipt(
        "clarification",
        "plan_different",
        draft,
      ),
    ).toBeNull();
    expect(
      resolveConversationPlanReceipt(
        "clarification",
        "plan_clarification",
        undefined,
      ),
    ).toBeNull();
    expect(
      resolveConversationPlanReceipt("clarification", "plan_clarification", {
        ...draft,
        plan: { missingContextQuestions: [] },
      }),
    ).toBeNull();
    expect(
      resolveConversationPlanReceipt("clarification", "plan_clarification", {
        ...draft,
        supersedesPlanId: "plan_previous",
      }),
    ).toBeNull();

    for (const status of ["running", "failed", "succeeded"] as const) {
      expect(
        resolveConversationPlanReceipt(
          "clarification",
          "plan_clarification",
          { ...draft, mission: { status } },
        ),
      ).toBeNull();
    }
  });

  it("explique qu’une clarification n’a produit aucune action", () => {
    expect(planReceiptMessage("clarification")).toBe(
      "Une précision est nécessaire avant de préparer ce plan. Aucune action n’a été exécutée.",
    );
  });

  it("n’atteste une révision que si son parent durable est identifié", () => {
    expect(
      resolveConversationPlanReceipt("revised", "plan_revised", {
        id: "plan_revised",
        approvalStatus: "awaiting_approval",
      }),
    ).toBeNull();
    expect(
      resolveConversationPlanReceipt("revised", "plan_revised", {
        id: "plan_revised",
        approvalStatus: "rejected",
        supersedesPlanId: "plan_previous",
      }),
    ).toBeNull();
    expect(
      resolveConversationPlanReceipt("cree", "plan_revised", {
        id: "plan_revised",
        approvalStatus: "awaiting_approval",
        supersedesPlanId: "plan_previous",
      }),
    ).toBeNull();
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
      ["revised", "awaiting_approval"],
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
