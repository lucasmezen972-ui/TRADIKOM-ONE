import { beforeEach, expect, it, vi } from "vitest";
import { AssetError } from "../src/modules/assets/errors";

const mocks = vi.hoisted(() => ({
  requireTenantContext: vi.fn(), upload: vi.fn(), workspace: vi.fn(), update: vi.fn(),
  revalidatePath: vi.fn(), redirect: vi.fn(),
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("@/lib/session", () => ({ requireTenantContext: mocks.requireTenantContext }));
vi.mock("@/lib/services", () => ({ getServices: async () => ({ uploadTenantAsset: mocks.upload, getWebsiteWorkspace: mocks.workspace, updateWebsiteSection: mocks.update }) }));
import { uploadSectionImageAction } from "../src/app/actions";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireTenantContext.mockResolvedValue({ user: { id: "actor_verified" }, tenant: { id: "tenant_verified" } });
  mocks.redirect.mockImplementation((url: string) => { throw new Error(`fixture-redirect:${url}`); });
});

function formWith(bytes: Uint8Array) {
  const form = new FormData();
  form.set("fichier", new File([new Uint8Array(bytes)], "fixture.png", { type: "image/png" }));
  form.set("userId", "actor_forged"); form.set("tenantId", "tenant_forged");
  return form;
}

it("rejects an oversized image before reading its bytes or calling the upload service", async () => {
  const form = formWith(new Uint8Array(3 * 1024 * 1024 + 1));
  const reader = vi.spyOn(form.get("fichier") as File, "arrayBuffer");
  await expect(uploadSectionImageAction(form)).rejects.toThrow("fixture-redirect:/mon-site?fichier=refuse");
  expect(reader).not.toHaveBeenCalled(); expect(mocks.upload).not.toHaveBeenCalled();
  expect(decodeURIComponent(mocks.redirect.mock.calls[0]![0])).toContain("3 Mo en préversion");
});

it("returns a normal French form refusal when the storage quota is reached", async () => {
  mocks.upload.mockRejectedValueOnce(new AssetError("asset_quota_exceeded", "La limite de stockage des images est atteinte."));
  await expect(uploadSectionImageAction(formWith(new Uint8Array([137,80,78,71,13,10,26,10])))).rejects.toThrow("fixture-redirect:/mon-site?fichier=refuse");
  expect(decodeURIComponent(mocks.redirect.mock.calls[0]![0])).toContain("La limite de stockage des images est atteinte.");
  expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.revalidatePath).not.toHaveBeenCalled();
});

it("uses the verified actor and tenant and confirms only a successful upload", async () => {
  const bytes = new Uint8Array([137,80,78,71,13,10,26,10]);
  mocks.upload.mockResolvedValueOnce({ id: "asset_fixture", url: "/fichiers/asset_fixture" });
  await expect(uploadSectionImageAction(formWith(bytes))).rejects.toThrow("fixture-redirect:/mon-site?fichier=ajoute");
  expect(mocks.upload).toHaveBeenCalledExactlyOnceWith("actor_verified", "tenant_verified", { kind: "section_image", originalName: "fixture.png", bytes });
  expect(mocks.revalidatePath).toHaveBeenCalledExactlyOnceWith("/mon-site");
});

it("rejects an empty selection without invoking persistence", async () => {
  await expect(uploadSectionImageAction(new FormData())).rejects.toThrow("fixture-redirect:/mon-site?fichier=vide");
  expect(mocks.upload).not.toHaveBeenCalled();
});

it("reports a vanished image explicitly if deletion wins before the section association", async () => {
  mocks.upload.mockResolvedValueOnce({ id: "asset_fixture", url: "/fichiers/asset_fixture" });
  mocks.workspace.mockResolvedValueOnce({ sections: [{ id: "section_fixture", title: "Titre fictif", body: "Texte fictif", enabled: true }] });
  mocks.update.mockRejectedValueOnce(new AssetError("asset_not_found", "Image indisponible."));
  const form = formWith(new Uint8Array([137,80,78,71,13,10,26,10]));
  form.set("sectionId", "section_fixture");
  await expect(uploadSectionImageAction(form)).rejects.toThrow("fixture-redirect:/mon-site?fichier=refuse");
  expect(decodeURIComponent(mocks.redirect.mock.calls[0]![0])).toContain("Renvoyez-la");
  expect(mocks.revalidatePath).not.toHaveBeenCalled();
});
