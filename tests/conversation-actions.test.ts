import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  decidePlan: vi.fn(),
  redirect: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: async () =>
    new Headers({ "x-correlation-id": "correlation-decision-test" }),
}));

vi.mock("next/cache", () => ({
  revalidatePath: mocks.revalidatePath,
}));

vi.mock("next/navigation", () => ({
  redirect: mocks.redirect,
}));

vi.mock("@/lib/session", () => ({
  requireTenantContext: async () => ({
    user: { id: "user_decision_test" },
    tenant: { id: "tenant_decision_test" },
  }),
}));

vi.mock("@/modules/channels", () => ({
  getConversationChannelServices: async () => ({
    decidePlan: mocks.decidePlan,
  }),
}));

import { decideConversationPlanAction } from "../src/app/(app)/conversation/actions";

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

describe("actions serveur Conversation", () => {
  it("refuse une décision malformée sans appeler le service ni rediriger", async () => {
    const logger = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const formData = decisionForm("approved-ish");

    await expect(decideConversationPlanAction(formData)).rejects.toMatchObject({
      code: "invalid_input",
      status: 400,
      message: expect.stringContaining(
        "Les informations fournies sont invalides. Référence : correlation-decision-test",
      ),
    });

    expect(mocks.decidePlan).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(logger.mock.calls.flat().join(" ")).not.toContain("approved-ish");
  });

  it("redirige une décision valide vers le plan réellement décidé", async () => {
    mocks.decidePlan.mockResolvedValue({
      id: "plan_authoritative",
      threadId: "thread_authoritative",
    });
    const formData = decisionForm("approved");

    await decideConversationPlanAction(formData);

    expect(mocks.decidePlan).toHaveBeenCalledWith(
      "user_decision_test",
      "tenant_decision_test",
      "plan_submitted",
      "approved",
      "Validation métier",
    );
    expect(mocks.revalidatePath).toHaveBeenCalledWith("/conversation");
    expect(mocks.redirect).toHaveBeenCalledWith(
      "/conversation?fil=thread_authoritative&plan=approved&plan_id=plan_authoritative",
    );
  });
});

function decisionForm(decision: string) {
  const formData = new FormData();
  formData.set("threadId", "thread_submitted");
  formData.set("planId", "plan_submitted");
  formData.set("decision", decision);
  formData.set("reason", "Validation métier");
  return formData;
}
