import { createHash } from "node:crypto";
import type { DbClient } from "@/lib/db";
import { id, nowIso } from "@/lib/security";
import type { Role } from "@/lib/types";
import { recordAuditLog } from "@/modules/audit";
import { AssetError } from "@/modules/assets/errors";
import {
  findTenantAssetById,
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
