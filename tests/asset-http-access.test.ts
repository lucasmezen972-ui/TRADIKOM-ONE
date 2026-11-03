import { beforeEach, describe, expect, it, vi } from "vitest";
import { GET } from "../src/app/fichiers/[assetId]/route";

const mocks = vi.hoisted(() => ({
  readPublicAsset: vi.fn(), readTenantAsset: vi.fn(),
  getCurrentSession: vi.fn(), getTenantContext: vi.fn(), getTenantIdFromCookie: vi.fn(),
}));
vi.mock("@/lib/services", () => ({ getServices: async () => mocks }));
vi.mock("@/lib/session", () => ({ getCurrentSession: mocks.getCurrentSession }));
vi.mock("@/lib/security", () => ({ getTenantIdFromCookie: mocks.getTenantIdFromCookie }));

const fixture = { bytes: new Uint8Array([137, 80, 78, 71]), contentType: "image/png", byteSize: 4, checksum: "fixture-checksum" };
const request = (assetId = "asset_fixture") => GET(
  new Request(`https://app.example.test/fichiers/${assetId}`),
  { params: Promise.resolve({ assetId }) },
);

beforeEach(() => {
  vi.resetAllMocks();
  mocks.readPublicAsset.mockResolvedValue(null);
  mocks.readTenantAsset.mockResolvedValue(null);
  mocks.getCurrentSession.mockResolvedValue(null);
  mocks.getTenantIdFromCookie.mockResolvedValue("tenant_cookie");
  mocks.getTenantContext.mockResolvedValue({ tenant: { id: "tenant_verified" } });
});

describe("asset HTTP access", () => {
  it("serves a publication anonymously with revalidation after publication changes", async () => {
    mocks.readPublicAsset.mockResolvedValue(fixture);
    const response = await request();
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(fixture.bytes);
    expect(response.headers.get("cache-control")).toBe("public, max-age=0, must-revalidate");
    expect(mocks.getCurrentSession).not.toHaveBeenCalled();
    expect(mocks.readTenantAsset).not.toHaveBeenCalled();
  });

  it("opens a draft only for the session's verified active organisation", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "user_verified" } });
    mocks.readTenantAsset.mockResolvedValue(fixture);
    const response = await request();
    expect(response.status).toBe(200);
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(fixture.bytes);
    expect(mocks.getTenantContext).toHaveBeenCalledWith("user_verified", "tenant_cookie");
    expect(mocks.readTenantAsset).toHaveBeenCalledWith("user_verified", "tenant_verified", "asset_fixture");
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-type")).toBe("image/png");
  });

  it("does not inspect private storage for an anonymous visitor", async () => {
    const response = await request();
    expect(response.status).toBe(404);
    expect(mocks.getTenantContext).not.toHaveBeenCalled();
    expect(mocks.readTenantAsset).not.toHaveBeenCalled();
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  });

  it("refuses a session with no verified organisation", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "user_verified" } });
    mocks.getTenantContext.mockResolvedValue(null);
    expect((await request()).status).toBe(404);
    expect(mocks.readTenantAsset).not.toHaveBeenCalled();
  });

  it("does not expose a private identifier from another organisation", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "user_verified" } });
    const response = await request("asset_other_tenant");
    expect(response.status).toBe(404);
    expect(mocks.readTenantAsset).toHaveBeenCalledWith("user_verified", "tenant_verified", "asset_other_tenant");
    expect(await response.text()).toBe("Fichier introuvable.");
  });

  it("redacts private access failures and never caches them publicly", async () => {
    mocks.getCurrentSession.mockResolvedValue({ user: { id: "user_verified" } });
    mocks.readTenantAsset.mockRejectedValue(new Error("storage/private-secret-canary"));
    const response = await request();
    expect(response.status).toBe(404);
    expect(await response.text()).toBe("Fichier introuvable.");
    expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
  });
});
