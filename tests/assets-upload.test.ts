import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import {
  createLocalAssetStorage,
  createUnavailableAssetStorage,
} from "../src/modules/assets/storage";
import {
  detectImageType,
  safeOriginalName,
  validateAssetBytes,
} from "../src/modules/assets/validation";
import { uploadTenantAsset } from "../src/modules/assets/service";

const opened: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

function pngBytes(payloadSize = 32) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return new Uint8Array([...signature, ...new Array(payloadSize).fill(0x01)]);
}

function webpBytes() {
  return new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    0x01, 0x02,
  ]);
}

async function setupTenant(suffix: string) {
  const db = await createMemoryDb();
  opened.push(db);
  const services = createServices(db);
  const owner = await services.registerUser({
    name: `Owner Fichiers ${suffix}`,
    email: `owner.fichiers.${suffix}@example.com`,
    password: "Password!1",
  });
  const tenant = await services.createTenant(owner.id, {
    name: `Garage Fichiers ${suffix}`,
    category: "Garage automobile",
  });
  const storageDir = await mkdtemp(path.join(tmpdir(), "tradikom-assets-"));
  return { db, services, owner, tenant, storageDir };
}

describe("asset validation", () => {
  it("identifies allowed image types from their binary signature", () => {
    expect(detectImageType(pngBytes())).toBe("image/png");
    expect(detectImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe(
      "image/jpeg",
    );
    expect(detectImageType(webpBytes())).toBe("image/webp");
  });

  it("rejects a payload whose extension lies about its content", () => {
    // Un script shell renommé « photo.png » ne doit jamais passer.
    const script = new TextEncoder().encode("#!/bin/sh\nrm -rf /\n");
    expect(detectImageType(script)).toBeNull();
    expect(validateAssetBytes(script)).toEqual({
      ok: false,
      code: "asset_type_not_allowed",
    });

    // Un RIFF sans marqueur WEBP n'est pas une image acceptée.
    const riffAudio = new Uint8Array([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
    ]);
    expect(detectImageType(riffAudio)).toBeNull();
  });

  it("rejects empty and oversized payloads", () => {
    expect(validateAssetBytes(new Uint8Array())).toEqual({
      ok: false,
      code: "asset_empty",
    });
    const huge = new Uint8Array(5 * 1024 * 1024 + 1);
    huge.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(validateAssetBytes(huge)).toEqual({
      ok: false,
      code: "asset_too_large",
    });
  });

  it("strips path separators and traversal segments from the display name", () => {
    expect(safeOriginalName("../../etc/passwd")).toBe("passwd");
    expect(safeOriginalName("C:\\Windows\\system32\\cmd.exe")).toBe("cmd.exe");
    expect(safeOriginalName("")).toBe("image");
    expect(safeOriginalName("photo\u0000.png")).toBe("photo.png");
  });
});

describe("asset upload", () => {
  it("stores a validated image under a server-generated key", async () => {
    const { db, owner, tenant, storageDir } = await setupTenant("stockage");
    const storage = createLocalAssetStorage(storageDir);

    const asset = await uploadTenantAsset(
      db,
      owner.id,
      tenant.id,
      {
        kind: "section_image",
        originalName: "../../mon logo.png",
        bytes: pngBytes(),
      },
      storage,
    );

    expect(asset.contentType).toBe("image/png");
    expect(asset.url).toBe(`/fichiers/${asset.id}`);
    // Le nom affiché est nettoyé, mais il ne sert pas de chemin.
    expect(asset.originalName).toBe("mon logo.png");

    const tenantDir = path.join(storageDir, tenant.id);
    const files = await readdir(tenantDir);
    expect(files).toEqual([`${asset.id}.png`]);
    const written = await readFile(path.join(tenantDir, files[0]!));
    expect(new Uint8Array(written)).toEqual(pngBytes());
  }, 60_000);

  it("refuses a disguised payload before anything is written", async () => {
    const { db, owner, tenant, storageDir } = await setupTenant("refus");
    const storage = createLocalAssetStorage(storageDir);

    await expect(
      uploadTenantAsset(
        db,
        owner.id,
        tenant.id,
        {
          kind: "section_image",
          originalName: "photo.png",
          bytes: new TextEncoder().encode("<?php system($_GET['c']); ?>"),
        },
        storage,
      ),
    ).rejects.toMatchObject({ code: "asset_type_not_allowed" });

    await expect(readdir(storageDir)).resolves.toEqual([]);
  }, 60_000);

  it("reports a clear error when no storage is configured", async () => {
    const { db, owner, tenant } = await setupTenant("sans-stockage");

    await expect(
      uploadTenantAsset(
        db,
        owner.id,
        tenant.id,
        {
          kind: "section_image",
          originalName: "logo.png",
          bytes: pngBytes(),
        },
        createUnavailableAssetStorage(),
      ),
    ).rejects.toMatchObject({ code: "asset_storage_unavailable" });
  }, 60_000);

  it("keeps assets isolated between organisations", async () => {
    const first = await setupTenant("iso-a");
    const second = await setupTenant("iso-b");
    const storage = createLocalAssetStorage(first.storageDir);

    const asset = await uploadTenantAsset(
      first.db,
      first.owner.id,
      first.tenant.id,
      { kind: "logo", originalName: "logo.png", bytes: pngBytes() },
      storage,
    );

    const listedByFirst = await first.services.getTenantAssets(
      first.owner.id,
      first.tenant.id,
    );
    expect(listedByFirst.map((item) => item.id)).toContain(asset.id);

    const listedBySecond = await second.services.getTenantAssets(
      second.owner.id,
      second.tenant.id,
    );
    expect(listedBySecond).toEqual([]);

    await expect(
      first.services.getTenantAssets(first.owner.id, second.tenant.id),
    ).rejects.toThrow();
  }, 60_000);

  it("refuses a storage key that would escape the storage root", async () => {
    const { storageDir } = await setupTenant("traversee");
    const storage = createLocalAssetStorage(storageDir);

    // La clé ne vient jamais de l'utilisateur ; ce garde-fou est une défense
    // en profondeur, vérifiée explicitement.
    await expect(storage.read("../../etc/passwd")).resolves.toBeNull();
  }, 60_000);
});
