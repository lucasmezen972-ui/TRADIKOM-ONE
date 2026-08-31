import { mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { defaultGarageOnboarding } from "../src/lib/generation";
import { createServices } from "../src/lib/services";
import {
  deleteTenantAsset,
  readPublicAsset,
  uploadTenantAsset,
} from "../src/modules/assets";
import { createLocalAssetStorage } from "../src/modules/assets/storage";

const opened: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

function pngBytes(payloadSize = 32) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return new Uint8Array([...signature, ...new Array(payloadSize).fill(0x01)]);
}

async function setupWithAsset(suffix: string) {
  const db = await createMemoryDb();
  opened.push(db);
  const services = createServices(db);
  const owner = await services.registerUser({
    name: `Owner Suppression ${suffix}`,
    email: `owner.suppression.${suffix}@example.com`,
    password: "Password!1",
  });
  const tenant = await services.createTenant(owner.id, {
    name: `Garage Suppression ${suffix}`,
    category: "Garage automobile",
  });
  await services.saveOnboarding(owner.id, tenant.id, defaultGarageOnboarding());
  const storageDir = await mkdtemp(path.join(tmpdir(), "tradikom-delete-"));
  const storage = createLocalAssetStorage(storageDir);
  const asset = await uploadTenantAsset(
    db,
    owner.id,
    tenant.id,
    {
      kind: "section_image",
      originalName: "visuel.png",
      bytes: pngBytes(),
    },
    storage,
  );
  return { db, services, owner, tenant, storage, storageDir, asset };
}

async function storedFileCount(storageDir: string, tenantId: string) {
  try {
    return (await readdir(path.join(storageDir, tenantId))).length;
  } catch {
    return 0;
  }
}

describe("asset deletion", () => {
  it("removes an unused file and its stored bytes", async () => {
    const { db, services, owner, tenant, storage, storageDir, asset } =
      await setupWithAsset("libre");

    expect(await storedFileCount(storageDir, tenant.id)).toBe(1);

    await deleteTenantAsset(db, owner.id, tenant.id, asset.id, storage);

    expect(await storedFileCount(storageDir, tenant.id)).toBe(0);
    const remaining = await services.getTenantAssets(owner.id, tenant.id);
    expect(remaining.some((item) => item.id === asset.id)).toBe(false);
    expect(await readPublicAsset(db, asset.id, storage)).toBeNull();
  }, 60_000);

  it("refuses to delete a file still shown by a section", async () => {
    const { db, services, owner, tenant, storage, storageDir, asset } =
      await setupWithAsset("section");

    const workspace = await services.getWebsiteWorkspace(owner.id, tenant.id);
    const section = workspace.sections[0]!;
    await services.updateWebsiteSection(owner.id, tenant.id, section.id, {
      title: section.title,
      body: section.body,
      imageUrl: asset.url,
      buttonLabel: section.buttonLabel,
      buttonHref: section.buttonHref,
      enabled: section.enabled,
    });

    await expect(
      deleteTenantAsset(db, owner.id, tenant.id, asset.id, storage),
    ).rejects.toMatchObject({ code: "asset_in_use" });

    // Ni la ligne ni le fichier ne bougent : la page publiée reste servie.
    expect(await storedFileCount(storageDir, tenant.id)).toBe(1);
    const remaining = await services.getTenantAssets(owner.id, tenant.id);
    expect(remaining.some((item) => item.id === asset.id)).toBe(true);

    // Une fois l'image retirée de la section, la suppression passe.
    await services.updateWebsiteSection(owner.id, tenant.id, section.id, {
      title: section.title,
      body: section.body,
      imageUrl: "",
      buttonLabel: section.buttonLabel,
      buttonHref: section.buttonHref,
      enabled: section.enabled,
    });
    await deleteTenantAsset(db, owner.id, tenant.id, asset.id, storage);
    expect(await storedFileCount(storageDir, tenant.id)).toBe(0);
  }, 60_000);

  it("refuses to delete a file referenced by the company profile", async () => {
    const { db, services, owner, tenant, storage, asset } =
      await setupWithAsset("profil");

    // Le profil range les visuels dans brand.photoUrls, alimenté par `photos`.
    const onboarding = defaultGarageOnboarding();
    await services.saveOnboarding(owner.id, tenant.id, {
      ...onboarding,
      photos: asset.url,
    });

    await expect(
      deleteTenantAsset(db, owner.id, tenant.id, asset.id, storage),
    ).rejects.toMatchObject({ code: "asset_in_use" });
  }, 60_000);

  it("does not expose another organisation's file", async () => {
    const first = await setupWithAsset("org-a");
    const second = await setupWithAsset("org-b");

    await expect(
      deleteTenantAsset(
        second.db,
        second.owner.id,
        second.tenant.id,
        first.asset.id,
        second.storage,
      ),
    ).rejects.toMatchObject({ code: "asset_not_found" });

    // Le fichier de la première organisation est intact.
    expect(await storedFileCount(first.storageDir, first.tenant.id)).toBe(1);
    expect(
      await readPublicAsset(first.db, first.asset.id, first.storage),
    ).not.toBeNull();
  }, 60_000);
});
