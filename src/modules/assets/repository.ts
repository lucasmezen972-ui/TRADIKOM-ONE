import type { DbClient } from "@/lib/db";
import type { AllowedImageType } from "@/modules/assets/validation";

export type TenantAssetRow = {
  id: string;
  tenant_id: string;
  kind: string;
  content_type: AllowedImageType;
  byte_size: number;
  checksum: string;
  storage_key: string;
  original_name: string;
  created_at: string;
};

export async function insertTenantAsset(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    kind: "section_image" | "logo";
    contentType: AllowedImageType;
    byteSize: number;
    checksum: string;
    storageKey: string;
    originalName: string;
    uploadedBy: string;
    createdAt: string;
  },
) {
  await db.query(
    `insert into tenant_assets
      (id, tenant_id, kind, content_type, byte_size, checksum, storage_key,
       original_name, uploaded_by, created_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      input.id,
      input.tenantId,
      input.kind,
      input.contentType,
      input.byteSize,
      input.checksum,
      input.storageKey,
      input.originalName,
      input.uploadedBy,
      input.createdAt,
    ],
  );
}

export async function findTenantAssetById(db: DbClient, assetId: string) {
  const result = await db.query<TenantAssetRow>(
    "select * from tenant_assets where id = $1",
    [assetId],
  );
  return result.rows[0] ?? null;
}

export async function findTenantAssetForTenant(
  db: DbClient,
  tenantId: string,
  assetId: string,
) {
  const result = await db.query<TenantAssetRow>(
    "select * from tenant_assets where tenant_id = $1 and id = $2",
    [tenantId, assetId],
  );
  return result.rows[0] ?? null;
}

export async function listTenantAssets(
  db: DbClient,
  tenantId: string,
  limit: number,
) {
  const result = await db.query<TenantAssetRow>(
    `select * from tenant_assets
     where tenant_id = $1
     order by created_at desc
     limit $2`,
    [tenantId, limit],
  );
  return result.rows;
}
