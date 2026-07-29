import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AllowedImageType } from "@/modules/assets/validation";

export type StoredAsset = {
  storageKey: string;
};

export type AssetStorage = {
  readonly name: string;
  put(input: {
    tenantId: string;
    assetId: string;
    extension: string;
    contentType: AllowedImageType;
    bytes: Uint8Array;
  }): Promise<StoredAsset>;
  read(storageKey: string): Promise<Uint8Array | null>;
  remove(storageKey: string): Promise<void>;
};

/**
 * Le stockage local convient au développement et à un hébergement disposant
 * d'un disque persistant. La clé est entièrement dérivée d'identifiants
 * générés côté serveur : aucun fragment ne provient du nom de fichier envoyé,
 * ce qui rend la traversée de répertoire impossible par construction.
 */
export function createLocalAssetStorage(rootDir: string): AssetStorage {
  const root = path.resolve(rootDir);

  return {
    name: "local",
    async put({ tenantId, assetId, extension, bytes }) {
      const storageKey = `${tenantId}/${assetId}.${extension}`;
      const target = resolveWithinRoot(root, storageKey);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes);
      return { storageKey };
    },
    async read(storageKey) {
      try {
        const target = resolveWithinRoot(root, storageKey);
        return new Uint8Array(await readFile(target));
      } catch {
        return null;
      }
    },
    async remove(storageKey) {
      try {
        await unlink(resolveWithinRoot(root, storageKey));
      } catch {
        // Un fichier déjà absent n'est pas une erreur : la ligne fait foi.
      }
    },
  };
}

export function createUnavailableAssetStorage(): AssetStorage {
  return {
    name: "unavailable",
    async put() {
      throw new AssetStorageUnavailableError();
    },
    async read() {
      return null;
    },
    async remove() {
      // Rien à supprimer : aucun fichier n'a pu être écrit.
    },
  };
}

export class AssetStorageUnavailableError extends Error {
  readonly code = "asset_storage_unavailable";

  constructor() {
    super("Aucun stockage de fichiers n'est configuré.");
    this.name = "AssetStorageUnavailableError";
  }
}

export function createRuntimeAssetStorage(): AssetStorage {
  const directory = process.env.ASSET_STORAGE_DIR?.trim();
  if (directory) {
    return createLocalAssetStorage(directory);
  }
  return createUnavailableAssetStorage();
}

/**
 * Défense en profondeur : même si une clé corrompue arrivait jusqu'ici, le
 * chemin résolu doit rester sous la racine de stockage.
 */
function resolveWithinRoot(root: string, storageKey: string) {
  const target = path.resolve(root, storageKey);
  const boundary = root.endsWith(path.sep) ? root : `${root}${path.sep}`;
  if (target !== root && !target.startsWith(boundary)) {
    throw new Error("Clé de stockage invalide.");
  }
  return target;
}
