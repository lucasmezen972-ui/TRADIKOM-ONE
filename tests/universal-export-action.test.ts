import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireTenantContext: vi.fn(),
  generate: vi.fn(),
  revalidatePath: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireTenantContext: mocks.requireTenantContext }));
vi.mock("@/lib/services", () => ({ getServices: async () => ({ generateUniversalExport: mocks.generate }) }));

import { generateUniversalExportAction } from "../src/app/actions";

afterEach(() => { vi.resetAllMocks(); });

it("ignore les identifiants acteur/tenant du formulaire et ne transmet que l’export choisi", async () => {
  mocks.requireTenantContext.mockResolvedValue({ user: { id: "actor_verified" }, tenant: { id: "tenant_verified" } });
  mocks.generate.mockResolvedValue({ status: "completed" });
  const form = new FormData();
  form.set("exportId", "export_selected");
  form.set("userId", "actor_forged");
  form.set("tenantId", "tenant_forged");
  await generateUniversalExportAction(form);
  expect(mocks.generate).toHaveBeenCalledExactlyOnceWith("actor_verified", "tenant_verified", "export_selected");
  expect(mocks.revalidatePath).toHaveBeenCalledExactlyOnceWith("/connexions/donnees");
});

it("n’appelle pas la génération si la session ou le tenant n’est pas autorisé", async () => {
  mocks.requireTenantContext.mockRejectedValue(new Error("Session requise"));
  const form = new FormData();
  form.set("exportId", "export_selected");
  await expect(generateUniversalExportAction(form)).rejects.toThrow("Session requise");
  expect(mocks.generate).not.toHaveBeenCalled();
  expect(mocks.revalidatePath).not.toHaveBeenCalled();
});
