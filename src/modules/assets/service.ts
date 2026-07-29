import { createHash } from "node:crypto";
import type { DbClient } from "@/lib/db";
import { id, nowIso } from "@/lib/security";
import type { Role } from "@/lib/types";
import { recordAuditLog } from "@/modules/audit";
import { AssetError } from "@/modules/assets/errors";
import {
  countAssetReferences,
  deleteTenantAssetRow,
  findTenantAssetById,
  findTenantAssetForTenant,
  insertTenantAsset,
  listTenantAssets,
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
import { assertTenantAccess } from "@/modules/tenants";

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
  storage: AssetStorage = createRuntimeAssetStorage(),
) {
  await assertTenantAccess(db, userId, tenantId, uploadRoles);

  const validation = validateAssetBytes(input.bytes);
  if (!validation.ok) {
    throw new AssetError(validation.code, rejectionMessage(validation.code));
  }

  const assetId = id("asset");
  const checksum = createHash("sha256").update(input.bytes).digest("hex");
  const originalName = safeOriginalName(input.originalName);

  let storageKey: string;
  try {
    const stored = await storage.put({
      tenantId,
      assetId,
      extension: extensionFor(validation.contentType),
      contentType: validation.contentType,
      bytes: input.bytes,
    });
    storageKey = stored.storageKey;
  } catch (error) {
    if (error instanceof AssetStorageUnavailableError) {
      throw new AssetError(
        "asset_storage_unavailable",
        "L'envoi de fichiers n'est pas configuré sur cette installation.",
      );
    }
    throw error;
  }

  const createdAt = nowIso();
  try {
    await insertTenantAsset(db, {
      id: assetId,
      tenantId,
      kind: input.kind,
      contentType: validation.contentType,
      byteSize: input.bytes.length,
      checksum,
      storageKey,
      originalName,
      uploadedBy: userId,
      createdAt,
    });
  } catch (error) {
    // Le fichier écrit sans ligne correspondante deviendrait orphelin.
    await storage.remove(storageKey);
    throw error;
  }

  await recordAuditLog(db, {
    tenantId,
    actorId: userId,
    action: "asset.uploaded",
    targetType: "asset",
    targetId: assetId,
    metadata: {
      kind: input.kind,
      contentType: validation.contentType,
      byteSize: input.bytes.length,
    },
  });

  return {
    id: assetId,
    url: assetPublicUrl(assetId),
    contentType: validation.contentType,
    byteSize: input.bytes.length,
    originalName,
    createdAt,
  };
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

/**
 * Lecture destinée à la route publique qui sert les images d'un site publié.
 * L'identifiant est un UUID non devinable ; la réponse ne révèle jamais
 * l'organisation propriétaire ni la clé de stockage.
 */
export async function readPublicAsset(
  db: DbClient,
  assetId: string,
  storage: AssetStorage = createRuntimeAssetStorage(),
) {
  const row = await findTenantAssetById(db, assetId);
  if (!row) {
    return null;
  }
  const bytes = await storage.read(row.storage_key);
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
  await assertTenantAccess(db, userId, tenantId, uploadRoles);
  const asset = await findTenantAssetForTenant(db, tenantId, assetId);
  if (!asset) {
    throw new AssetError("asset_not_found", "Ce fichier n'existe plus.");
  }

  const references = await countAssetReferences(
    db,
    tenantId,
    assetPublicUrl(assetId),
  );
  if (references.sections > 0 || references.profile > 0) {
    throw new AssetError("asset_in_use", referenceMessage(references));
  }

  const deleted = await deleteTenantAssetRow(db, tenantId, assetId);
  if (!deleted) {
    throw new AssetError("asset_not_found", "Ce fichier n'existe plus.");
  }

  // La ligne d'abord, le fichier ensuite. Si l'effacement du fichier échoue,
  // il reste un orphelin invisible ; dans l'ordre inverse, une ligne
  // survivante pointerait vers un fichier absent et servirait un 404.
  await storage.remove(asset.storage_key);
  await recordAuditLog(db, {
    tenantId,
    actorId: userId,
    action: "asset.deleted",
    targetType: "asset",
    targetId: assetId,
    metadata: {
      kind: asset.kind,
      byteSize: asset.byte_size,
    },
  });

  return { id: assetId };
}

function referenceMessage(references: { sections: number; profile: number }) {
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
  return `Ce fichier est encore utilisé par ${places.join(" et ")}. Remplacez-le à cet endroit avant de le supprimer.`;
}

export function assetPublicUrl(assetId: string) {
  return `/fichiers/${assetId}`;
}

function rejectionMessage(code: string) {
  switch (code) {
    case "asset_empty":
      return "Le fichier est vide.";
    case "asset_too_large":
      return "Le fichier dépasse la taille autorisée de 5 Mo.";
    default:
      return "Seules les images PNG, JPEG et WebP sont acceptées.";
  }
}
