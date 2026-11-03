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
  storage_backend: "external" | "postgres";
  original_name: string;
  created_at: string;
};

export type TenantAssetContentRow = TenantAssetRow & {
  content_bytes: Uint8Array | null;
};

// Listing and deletion never fetch potentially large private image payloads.
const assetMetadataColumns = "id, tenant_id, kind, content_type, byte_size, checksum, storage_key, storage_backend, original_name, created_at";

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
    contentBytes?: Uint8Array;
  },
) {
  await db.query(
    `insert into tenant_assets
      (id, tenant_id, kind, content_type, byte_size, checksum, storage_key,
       original_name, uploaded_by, created_at, storage_backend, content_bytes)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
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
      input.contentBytes ? "postgres" : "external",
      input.contentBytes ?? null,
    ],
  );
}

export async function findTenantAssetById(db: DbClient, assetId: string) {
  const result = await db.query<TenantAssetRow>(
    `select ${assetMetadataColumns} from tenant_assets where id = $1`,
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
    `select ${assetMetadataColumns} from tenant_assets where tenant_id = $1 and id = $2`,
    [tenantId, assetId],
  );
  return result.rows[0] ?? null;
}

export async function findTenantAssetContentForTenant(
  db: DbClient,
  tenantId: string,
  assetId: string,
) {
  const result = await db.query<TenantAssetContentRow>(
    `select ${assetMetadataColumns}, content_bytes from tenant_assets where tenant_id = $1 and id = $2`,
    [tenantId, assetId],
  );
  return result.rows[0] ?? null;
}

export async function findStoredTenantAssetByChecksum(
  db: DbClient,
  tenantId: string,
  kind: "section_image" | "logo",
  checksum: string,
) {
  const result = await db.query<TenantAssetRow>(
    `select ${assetMetadataColumns} from tenant_assets
     where tenant_id = $1 and kind = $2 and checksum = $3 and storage_backend = 'postgres'
     order by created_at asc, id asc limit 1`,
    [tenantId, kind, checksum],
  );
  return result.rows[0] ?? null;
}

export async function listTenantAssets(
  db: DbClient,
  tenantId: string,
  limit: number,
) {
  const result = await db.query<TenantAssetRow>(
    `select ${assetMetadataColumns} from tenant_assets
     where tenant_id = $1
     order by created_at desc
     limit $2`,
    [tenantId, limit],
  );
  return result.rows;
}

/**
 * Conserve aussi les images du dernier snapshot publié quand le brouillon
 * les a déjà remplacées. Le broker ne projette que les sections publiques
 * cohérentes du tenant. La recherche par sous-chaîne suffit pour le profil :
 * l'URL contient un identifiant non devinable, sans collision réaliste.
 */
export async function countAssetReferences(
  db: DbClient,
  tenantId: string,
  assetUrl: string,
) {
  const sections = await db.query<{ count: number }>(
    `select count(*)::int as count from website_sections
     where tenant_id = $1 and image_url = $2`,
    [tenantId, assetUrl],
  );
  const profiles = await db.query<{ count: number }>(
    `select count(*)::int as count from business_profiles
     where tenant_id = $1 and position($2 in data) > 0`,
    [tenantId, assetUrl],
  );
  const publications = await db.query<{ count: number }>(
    `select count(*)::int as count
     from tenants t
     cross join lateral app_private.app_public_site_by_slug(t.slug) p
     cross join lateral pg_catalog.jsonb_array_elements(p.sections) section(value)
     where t.id = $1 and p.tenant_id = t.id
       and section.value ->> 'imageUrl' = $2`,
    [tenantId, assetUrl],
  );
  return {
    sections: Number(sections.rows[0]?.count ?? 0),
    profile: Number(profiles.rows[0]?.count ?? 0),
    published: Number(publications.rows[0]?.count ?? 0),
  };
}

export async function deleteTenantAssetRow(
  db: DbClient,
  tenantId: string,
  assetId: string,
) {
  const result = await db.query<{ id: string }>(
    `delete from tenant_assets
     where tenant_id = $1 and id = $2
     returning id`,
    [tenantId, assetId],
  );
  return result.rows[0]?.id ?? null;
}

/** Content is returned only for an image in the latest public snapshot. */
export async function findPublicAssetById(db: DbClient, assetId: string) {
  const result = await db.query<Pick<TenantAssetContentRow, "content_type" | "byte_size" | "checksum" | "storage_key" | "storage_backend" | "content_bytes">>(
    "select * from app_private.app_public_asset_by_id($1)", [assetId],
  );
  return result.rows[0] ?? null;
}
