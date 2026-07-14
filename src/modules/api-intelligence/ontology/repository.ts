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

export type GlobalMappingRow = {
  id: string;
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
  promotion_reason: string | null;
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
    `select api_tenant_mappings.*
     from api_tenant_mappings
     join api_evidence
       on api_evidence.id = api_tenant_mappings.evidence_id
     join api_claims
       on api_claims.id = api_evidence.claim_id
      and api_claims.approval_status = 'approved'
     join api_source_snapshots
       on api_source_snapshots.id = api_evidence.source_snapshot_id
     join api_sources
       on api_sources.id = api_source_snapshots.source_id
      and api_sources.api_product_id = api_tenant_mappings.api_product_id
     where api_tenant_mappings.tenant_id = $1
       and api_tenant_mappings.api_product_id = $2
       and api_tenant_mappings.approval_status = 'approved'
     order by api_tenant_mappings.source_entity asc`,
    [tenantId, apiProductId],
  );
  return result.rows;
}

export async function findPromotableTenantMapping(
  db: DbClient,
  tenantId: string,
  mappingId: string,
) {
  const result = await db.query<TenantMappingRow & {
    evidence_claim_status: string;
    source_classification: string;
  }>(
    `select api_tenant_mappings.*,
            api_claims.approval_status as evidence_claim_status,
            api_sources.source_classification
     from api_tenant_mappings
     join api_evidence on api_evidence.id = api_tenant_mappings.evidence_id
     join api_claims on api_claims.id = api_evidence.claim_id
     join api_source_snapshots
       on api_source_snapshots.id = api_evidence.source_snapshot_id
     join api_sources on api_sources.id = api_source_snapshots.source_id
       and api_sources.api_product_id = api_tenant_mappings.api_product_id
     where api_tenant_mappings.tenant_id = $1
       and api_tenant_mappings.id = $2`,
    [tenantId, mappingId],
  );
  return result.rows[0] ?? null;
}

export async function findGlobalMappingByShape(
  db: DbClient,
  input: Pick<
    TenantMappingRow,
    | "api_product_id"
    | "source_entity"
    | "canonical_entity"
    | "source_field"
    | "canonical_field"
  >,
) {
  const result = await db.query<GlobalMappingRow>(
    `select * from api_global_mappings
     where api_product_id = $1
       and source_entity = $2
       and canonical_entity = $3
       and coalesce(source_field, '') = coalesce($4, '')
       and coalesce(canonical_field, '') = coalesce($5, '')`,
    [
      input.api_product_id,
      input.source_entity,
      input.canonical_entity,
      input.source_field,
      input.canonical_field,
    ],
  );
  return result.rows[0] ?? null;
}

export async function insertGlobalOntologyMapping(
  db: DbClient,
  input: {
    id: string;
    mapping: TenantMappingRow;
    reason: string;
    approvedBy: string;
    createdAt: string;
  },
) {
  await db.query(
    `insert into api_global_mappings (
       id, api_product_id, source_entity, canonical_entity,
       source_field, canonical_field, confidence, evidence_id,
       approval_status, version, created_by, approved_by,
       promotion_reason, created_at, updated_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
               $13, $14, $14)`,
    [
      input.id,
      input.mapping.api_product_id,
      input.mapping.source_entity,
      input.mapping.canonical_entity,
      input.mapping.source_field,
      input.mapping.canonical_field,
      input.mapping.confidence,
      input.mapping.evidence_id,
      "approved",
      1,
      input.approvedBy,
      input.approvedBy,
      input.reason,
      input.createdAt,
    ],
  );
}

export async function findApprovedGlobalMapping(
  db: DbClient,
  globalMappingId: string,
) {
  const result = await db.query<GlobalMappingRow & {
    evidence_claim_status: string;
    source_classification: string;
  }>(
    `select api_global_mappings.*,
            api_claims.approval_status as evidence_claim_status,
            api_sources.source_classification
     from api_global_mappings
     join api_evidence on api_evidence.id = api_global_mappings.evidence_id
     join api_claims on api_claims.id = api_evidence.claim_id
     join api_source_snapshots
       on api_source_snapshots.id = api_evidence.source_snapshot_id
     join api_sources on api_sources.id = api_source_snapshots.source_id
       and api_sources.api_product_id = api_global_mappings.api_product_id
     where api_global_mappings.id = $1
       and api_global_mappings.approval_status = 'approved'`,
    [globalMappingId],
  );
  return result.rows[0] ?? null;
}

export async function findTenantMappingByShape(
  db: DbClient,
  tenantId: string,
  mapping: GlobalMappingRow,
) {
  const result = await db.query<TenantMappingRow>(
    `select * from api_tenant_mappings
     where tenant_id = $1
       and api_product_id = $2
       and source_entity = $3
       and canonical_entity = $4
       and coalesce(source_field, '') = coalesce($5, '')
       and coalesce(canonical_field, '') = coalesce($6, '')`,
    [
      tenantId,
      mapping.api_product_id,
      mapping.source_entity,
      mapping.canonical_entity,
      mapping.source_field,
      mapping.canonical_field,
    ],
  );
  return result.rows[0] ?? null;
}

export async function listApprovedGlobalMappings(db: DbClient) {
  const result = await db.query<GlobalMappingRow>(
    `select * from api_global_mappings
     where approval_status = 'approved'
     order by api_product_id asc, source_entity asc, canonical_entity asc`,
  );
  return result.rows;
}
