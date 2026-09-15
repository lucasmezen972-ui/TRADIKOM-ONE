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

  it("reconnaît uniquement les sept états durables correspondants", () => {
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
      resolveConversationPlanReceipt(
        "delegated",
        "plan_delegated",
        {
          id: "plan_delegated",
          approvalStatus: "awaiting_approval",
          delegation: {
            id: "delegation_durable",
            version: 1,
            delegatedToUserId: "user_responsable",
          },
        },
        "delegation_durable",
      ),
    ).toBe("delegated");
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
    expect(
      resolveConversationPlanReceipt("revised", "plan_revised", {
        id: "plan_revised",
        approvalStatus: "awaiting_approval",
        supersedesPlanId: "plan_previous",
        delegation: {
          id: "delegation_durable",
          version: 1,
          delegatedToUserId: "user_responsable",
        },
      }),
    ).toBeNull();
  });

  it("n’atteste la délégation que si l’affectation durable exacte existe", () => {
    const delegatedPlan = {
      id: "plan_delegated",
      approvalStatus: "awaiting_approval" as const,
      delegation: {
        id: "delegation_durable",
        version: 1,
        delegatedToUserId: "user_responsable",
      },
    };

    expect(
      resolveConversationPlanReceipt(
        "delegated",
        "plan_delegated",
        delegatedPlan,
        "delegation_durable",
      ),
    ).toBe("delegated");
    expect(
      resolveConversationPlanReceipt("delegated", "plan_delegated", {
        ...delegatedPlan,
        delegation: null,
      }, "delegation_durable"),
    ).toBeNull();
    expect(
      resolveConversationPlanReceipt("delegated", "plan_delegated", {
        ...delegatedPlan,
        delegation: { ...delegatedPlan.delegation, version: 0 },
      }, "delegation_durable"),
    ).toBeNull();
    expect(
      resolveConversationPlanReceipt("delegated", "plan_delegated", {
        ...delegatedPlan,
        approvalStatus: "approved",
      }, "delegation_durable"),
    ).toBeNull();
    expect(
      resolveConversationPlanReceipt(
        "delegated",
        "plan_delegated",
        delegatedPlan,
      ),
    ).toBeNull();
    expect(
      resolveConversationPlanReceipt(
        "delegated",
        "plan_delegated",
        delegatedPlan,
        "delegation_obsolete",
      ),
    ).toBeNull();
    expect(
      resolveConversationPlanReceipt("cree", "plan_delegated", delegatedPlan),
    ).toBeNull();
    expect(
      resolveConversationPlanReceipt("delegated", "plan_delegated", {
        ...delegatedPlan,
        mission: { status: "running" },
      }, "delegation_durable"),
    ).toBeNull();
  });

  it("explique qu’une délégation n’exécute aucune action", () => {
    expect(planReceiptMessage("delegated")).toBe(
      "Décision déléguée. Le plan reste en attente de validation et aucune action n’a été exécutée.",
    );
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
    for (const [receipt, approvalStatus, extra] of [
      ["cree", "awaiting_approval"],
      ["revised", "awaiting_approval"],
      [
        "delegated",
        "awaiting_approval",
        {
          delegation: {
            id: "delegation_durable",
            version: 1,
            delegatedToUserId: "user_responsable",
          },
        },
      ],
      ["approved", "approved"],
      ["rejected", "rejected"],
    ] as const) {
      for (const status of ["running", "failed", "succeeded"] as const) {
        expect(
          resolveConversationPlanReceipt(receipt, `plan_${receipt}`, {
            id: `plan_${receipt}`,
            approvalStatus,
            ...extra,
            mission: { status },
          }, receipt === "delegated" ? "delegation_durable" : undefined),
        ).toBeNull();
      }
    }
  });
});
