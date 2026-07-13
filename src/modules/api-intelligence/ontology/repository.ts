import type { DbClient } from "@/lib/db";

export type TenantMappingRow = {
  id: string;
  tenant_id: string;
  api_product_id: string;
  source_entity: string;
  canonical_entity: string;
  source_field: string | null;
  canonical_field: string | null;
  confidence: number;
  evidence_id: string;
  approval_status: string;
  version: number;
  created_by: string;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
};

export async function insertTenantOntologyMapping(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    apiProductId: string;
    sourceEntity: string;
    canonicalEntity: string;
    sourceField?: string;
    canonicalField?: string;
    confidence: number;
    evidenceId: string;
    createdBy: string;
    createdAt: string;
  },
) {
  await db.query(
    `insert into api_tenant_mappings (
       id, tenant_id, api_product_id, source_entity, canonical_entity,
       source_field, canonical_field, confidence, evidence_id,
       approval_status, version, created_by, approved_by, created_at, updated_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      input.id,
      input.tenantId,
      input.apiProductId,
      input.sourceEntity,
      input.canonicalEntity,
      input.sourceField ?? null,
      input.canonicalField ?? null,
      input.confidence,
      input.evidenceId,
      "pending",
      1,
      input.createdBy,
      null,
      input.createdAt,
      input.createdAt,
    ],
  );
}

export async function findTenantOntologyMapping(
  db: DbClient,
  tenantId: string,
  mappingId: string,
) {
  const result = await db.query<TenantMappingRow>(
    "select * from api_tenant_mappings where tenant_id = $1 and id = $2",
    [tenantId, mappingId],
  );
  return result.rows[0] ?? null;
}

export async function setTenantMappingApproval(
  db: DbClient,
  input: {
    tenantId: string;
    mappingId: string;
    status: "approved" | "rejected";
    approvedBy: string;
    updatedAt: string;
  },
) {
  await db.query(
    `update api_tenant_mappings
     set approval_status = $1, approved_by = $2, updated_at = $3
     where tenant_id = $4 and id = $5`,
    [
      input.status,
      input.approvedBy,
      input.updatedAt,
      input.tenantId,
      input.mappingId,
    ],
  );
}

export async function listApprovedTenantMappings(
  db: DbClient,
  tenantId: string,
  apiProductId: string,
) {
  const result = await db.query<TenantMappingRow>(
    `select * from api_tenant_mappings
     where tenant_id = $1 and api_product_id = $2 and approval_status = 'approved'
     order by source_entity asc`,
    [tenantId, apiProductId],
  );
  return result.rows;
}
