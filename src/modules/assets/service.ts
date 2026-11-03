import { createHash } from "node:crypto";
import { withTenantDbTransaction } from "@/db/tenant-context";
import type { DbClient } from "@/lib/db";
import { id, nowIso } from "@/lib/security";
import type { Role } from "@/lib/types";
import { recordAuditLog } from "@/modules/audit";
import { AssetError } from "@/modules/assets/errors";
import {
  countAssetReferences,
  deleteTenantAssetRow,
  findPublicAssetById,
  findStoredTenantAssetByChecksum,
  findTenantAssetContentForTenant,
  findTenantAssetForTenant,
  insertTenantAsset,
  listTenantAssets,
  type TenantAssetContentRow,
  type TenantAssetRow,
} from "@/modules/assets/repository";
import {
  AssetStorageUnavailableError,
  createRuntimeAssetStorage,
  type AssetStorage,
} from "@/modules/assets/storage";
import {
  extensionFor,
  safeOriginalName,
  validateAssetBytes,
} from "@/modules/assets/validation";
import { assertTenantAccess, lockTenantForPublicationMutation } from "@/modules/tenants";

const uploadRoles: Role[] = ["owner", "administrator", "manager"];

export type UploadAssetInput = {
  kind: "section_image" | "logo";
  originalName: string;
  bytes: Uint8Array;
};

export async function uploadTenantAsset(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: UploadAssetInput,
  storage?: AssetStorage,
) {
  if ((db as DbClient & { __transaction?: boolean }).__transaction) {
    throw new AssetError(
      "asset_transaction_not_supported",
      "L'envoi de fichier doit démarrer dans une transaction indépendante.",
    );
  }
  let stagedExternalKey: string | undefined;
  try {
    return await withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
      await assertTenantAccess(transaction, userId, tenantId, uploadRoles);
      const validation = validateAssetBytes(input.bytes);
      if (!validation.ok) {
        throw new AssetError(validation.code, rejectionMessage(validation.code));
      }
      await lockTenantForPublicationMutation(transaction, tenantId);
      const checksum = createHash("sha256").update(input.bytes).digest("hex");
      // The tenant lock makes retries reuse the same persisted bytes, even at quota.
      if (!storage) {
        const existing = await findStoredTenantAssetByChecksum(transaction, tenantId, input.kind, checksum);
        if (existing) return assetSummary(existing);
      }
      const assetId = id("asset");
      const originalName = safeOriginalName(input.originalName);
      const createdAt = nowIso();
      let storageKey = `dbasset:${tenantId}:${assetId}`;
      if (storage) {
        const stored = await storage.put({
          tenantId, assetId, extension: extensionFor(validation.contentType),
          contentType: validation.contentType, bytes: input.bytes,
        });
        storageKey = stored.storageKey;
        stagedExternalKey = storageKey;
      }
      await insertTenantAsset(transaction, {
        id: assetId, tenantId, kind: input.kind, contentType: validation.contentType,
        byteSize: input.bytes.byteLength, checksum, storageKey, originalName,
        uploadedBy: userId, createdAt, contentBytes: storage ? undefined : input.bytes,
      });
      await recordAuditLog(transaction, {
        tenantId, actorId: userId, action: "asset.uploaded", targetType: "asset", targetId: assetId,
        metadata: { kind: input.kind, contentType: validation.contentType, byteSize: input.bytes.byteLength },
      });
      return { id: assetId, url: assetPublicUrl(assetId), contentType: validation.contentType,
        byteSize: input.bytes.byteLength, originalName, createdAt };
    });
  } catch (error) {
    if (storage && stagedExternalKey) {
      // An injected development storage must not retain a file after DB rollback.
      try { await storage.remove(stagedExternalKey); } catch { /* Invisible orphan; preserve the original failure. */ }
    }
    if (error instanceof AssetStorageUnavailableError) {
      throw new AssetError("asset_storage_unavailable", "L'envoi de fichiers n'est pas configuré sur cette installation.");
    }
    if (error instanceof Error && error.message === "asset_quota_exceeded") {
      throw new AssetError("asset_quota_exceeded", "La limite de stockage des images est atteinte. Supprimez un fichier inutilisé avant un nouvel envoi.");
    }
    throw error;
  }
}

export async function getTenantAssets(
  db: DbClient,
  userId: string,
  tenantId: string,
  limit = 24,
) {
  await assertTenantAccess(db, userId, tenantId);
  const rows = await listTenantAssets(db, tenantId, Math.min(limit, 100));
  return rows.map((row) => ({
    id: row.id,
    url: assetPublicUrl(row.id),
    contentType: row.content_type,
    byteSize: row.byte_size,
    originalName: row.original_name,
    createdAt: row.created_at,
  }));
}

export async function readTenantAsset(
  db: DbClient,
  userId: string,
  tenantId: string,
  assetId: string,
  storage: AssetStorage = createRuntimeAssetStorage(),
) {
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId);
    const row = await findTenantAssetContentForTenant(transaction, tenantId, assetId);
    if (!row) return null;
    const bytes = await readAssetBytes(row, storage);
    return bytes ? {
      bytes,
      contentType: row.content_type,
      checksum: row.checksum,
      byteSize: row.byte_size,
    } : null;
  });
}

/**
 * Lecture destinée à la route publique qui sert les images d'un site publié.
 * Seules les références du dernier snapshot publié autorisent cette lecture.
 * Les brouillons et les fichiers privés restent inaccessibles, même par ID.
 */
export async function readPublicAsset(
  db: DbClient,
  assetId: string,
  storage: AssetStorage = createRuntimeAssetStorage(),
) {
  const row = await findPublicAssetById(db, assetId);
  if (!row) {
    return null;
  }
  const bytes = await readAssetBytes(row, storage);
  if (!bytes) {
    return null;
  }
  return {
    bytes,
    contentType: row.content_type,
    checksum: row.checksum,
    byteSize: row.byte_size,
  };
}

/**
 * Supprimer un fichier encore affiché casserait une page publiée sans que
 * personne ne s'en aperçoive : l'image manquante ne produit qu'un 404
 * silencieux. La suppression est donc refusée tant que le fichier est
 * référencé, et le message dit où il est utilisé.
 */
export async function deleteTenantAsset(
  db: DbClient,
  userId: string,
  tenantId: string,
  assetId: string,
  storage: AssetStorage = createRuntimeAssetStorage(),
) {
  // This service must own the commit before it can remove irreversible bytes.
  if ((db as DbClient & { __transaction?: boolean }).__transaction) {
    throw new AssetError(
      "asset_transaction_not_supported",
      "La suppression de fichier doit démarrer dans une transaction indépendante.",
    );
  }
  const asset = await withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, uploadRoles);
    await lockTenantForPublicationMutation(transaction, tenantId);
    const asset = await findTenantAssetForTenant(transaction, tenantId, assetId);
    if (!asset) {
      throw new AssetError("asset_not_found", "Ce fichier n'existe plus.");
    }

    const references = await countAssetReferences(transaction, tenantId, assetPublicUrl(assetId));
    if (references.sections > 0 || references.profile > 0 || references.published > 0) {
      throw new AssetError("asset_in_use", referenceMessage(references));
    }

    const deleted = await deleteTenantAssetRow(transaction, tenantId, assetId);
    if (!deleted) {
      throw new AssetError("asset_not_found", "Ce fichier n'existe plus.");
    }
    // The logical deletion and its audit succeed or roll back together.
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "asset.deleted",
      targetType: "asset",
      targetId: assetId,
      metadata: { kind: asset.kind, byteSize: asset.byte_size },
    });
    return asset;
  });

  // No storage I/O occurs under the tenant lock or before the DB commit.
  // A storage failure leaves an audited logical deletion and invisible bytes.
  if (asset.storage_backend !== "postgres") await storage.remove(asset.storage_key);

  return { id: assetId };
}

function assetSummary(row: TenantAssetRow) {
  return { id: row.id, url: assetPublicUrl(row.id), contentType: row.content_type,
    byteSize: row.byte_size, originalName: row.original_name, createdAt: row.created_at };
}

async function readAssetBytes(
  row: Pick<TenantAssetContentRow, "storage_backend" | "content_bytes" | "storage_key" | "byte_size" | "checksum" | "content_type">,
  storage: AssetStorage,
) {
  if (row.storage_backend !== "postgres") return storage.read(row.storage_key);
  if (!(row.content_bytes instanceof Uint8Array)) return null;
  const bytes = row.content_bytes;
  const validated = validateAssetBytes(bytes);
  if (bytes.byteLength !== row.byte_size || !validated.ok || validated.contentType !== row.content_type
    || createHash("sha256").update(bytes).digest("hex") !== row.checksum) return null;
  return bytes;
}

function referenceMessage(references: { sections: number; profile: number; published: number }) {
  const places: string[] = [];
  if (references.sections > 0) {
    places.push(
      references.sections > 1
        ? `${references.sections} sections de votre site`
        : "une section de votre site",
    );
  }
  if (references.profile > 0) {
    places.push("le profil de votre entreprise");
  }
  if (references.published > 0) {
    places.push("la version publiée de votre site");
  }
  return `Ce fichier est encore utilisé par ${places.join(" et ")}. ${references.published > 0
    ? "Publiez d'abord une version sans ce fichier avant de le supprimer."
    : "Remplacez-le à cet endroit avant de le supprimer."}`;
}

export function assetPublicUrl(assetId: string) {
  return `/fichiers/${assetId}`;
}

function rejectionMessage(code: string) {
  switch (code) {
    case "asset_empty":
      return "Le fichier est vide.";
    case "asset_too_large":
      return "Le fichier dépasse la taille autorisée de 3 Mo en préversion.";
    default:
      return "Seules les images PNG, JPEG et WebP sont acceptées.";
  }
}
