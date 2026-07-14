import type { DbClient } from "@/lib/db";
import type {
  BusinessBrainDomain,
  BusinessBrainEvidenceType,
  BusinessBrainSource,
} from "@/modules/business-brain/schemas";

export type BusinessBrainEntryRow = {
  id: string;
  tenant_id: string;
  entry_key: string;
  domain: BusinessBrainDomain;
  title: string;
  summary: string;
  details: string;
  source_type: BusinessBrainSource;
  source_ref: string | null;
  confidence: number;
  status: "active" | "superseded" | "archived";
  version: number;
  supersedes_id: string | null;
  created_by: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type BusinessBrainEvidenceRow = {
  id: string;
  tenant_id: string;
  entry_id: string;
  evidence_type: BusinessBrainEvidenceType;
  source_ref: string | null;
  summary: string;
  captured_at: string;
  created_by: string;
  created_at: string;
};

export type BusinessBrainSignalRow = {
  business_profile_data: string | null;
  business_profile_updated_at: string | null;
  contact_count: number | string;
  opportunity_count: number | string;
  pipeline_value_cents: number | string;
  member_count: number | string;
  workflow_count: number | string;
  website_count: number | string;
  published_website_count: number | string;
  connector_count: number | string;
  api_asset_count: number | string;
};

export async function insertBusinessBrainEntry(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    entryKey: string;
    domain: BusinessBrainDomain;
    title: string;
    summary: string;
    details: string;
    sourceType: BusinessBrainSource;
    sourceRef?: string;
    confidence: number;
    version: number;
    supersedesId?: string;
    actorId: string;
    now: string;
  },
) {
  await db.query(
    `insert into business_brain_entries (
       id, tenant_id, entry_key, domain, title, summary, details, source_type,
       source_ref, confidence, status, version, supersedes_id, created_by,
       reviewed_by, reviewed_at, created_at, updated_at
     ) values (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active', $11, $12, $13,
       $13, $14, $14, $14
     )`,
    [
      input.id,
      input.tenantId,
      input.entryKey,
      input.domain,
      input.title,
      input.summary,
      input.details,
      input.sourceType,
      input.sourceRef ?? null,
      input.confidence,
      input.version,
      input.supersedesId ?? null,
      input.actorId,
      input.now,
    ],
  );
}

export async function insertBusinessBrainEvidence(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    entryId: string;
    evidenceType: BusinessBrainEvidenceType;
    sourceRef?: string;
    summary: string;
    actorId: string;
    now: string;
  },
) {
  await db.query(
    `insert into business_brain_evidence (
       id, tenant_id, entry_id, evidence_type, source_ref, summary,
       captured_at, created_by, created_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $7)`,
    [
      input.id,
      input.tenantId,
      input.entryId,
      input.evidenceType,
      input.sourceRef ?? null,
      input.summary,
      input.now,
      input.actorId,
    ],
  );
}

export async function findActiveBusinessBrainEntry(
  db: DbClient,
  tenantId: string,
  entryId: string,
) {
  const result = await db.query<BusinessBrainEntryRow>(
    `select *
     from business_brain_entries
     where tenant_id = $1 and id = $2 and status = 'active'`,
    [tenantId, entryId],
  );
  return result.rows[0] ?? null;
}

export async function supersedeBusinessBrainEntry(
  db: DbClient,
  tenantId: string,
  entryId: string,
  now: string,
) {
  const result = await db.query<{ id: string }>(
    `update business_brain_entries
     set status = 'superseded', updated_at = $3
     where tenant_id = $1 and id = $2 and status = 'active'
     returning id`,
    [tenantId, entryId, now],
  );
  return result.rows[0] ?? null;
}

export async function archiveBusinessBrainEntry(
  db: DbClient,
  tenantId: string,
  entryId: string,
  now: string,
) {
  const result = await db.query<{ id: string }>(
    `update business_brain_entries
     set status = 'archived', updated_at = $3
     where tenant_id = $1 and id = $2 and status = 'active'
     returning id`,
    [tenantId, entryId, now],
  );
  return result.rows[0] ?? null;
}

export async function listActiveBusinessBrainEntries(
  db: DbClient,
  tenantId: string,
) {
  const result = await db.query<BusinessBrainEntryRow>(
    `select *
     from business_brain_entries
     where tenant_id = $1 and status = 'active'
     order by domain asc, updated_at desc, id asc`,
    [tenantId],
  );
  return result.rows;
}

export async function listActiveBusinessBrainEvidence(
  db: DbClient,
  tenantId: string,
) {
  const result = await db.query<BusinessBrainEvidenceRow>(
    `select evidence.*
     from business_brain_evidence as evidence
     join business_brain_entries as entries
       on entries.tenant_id = evidence.tenant_id
      and entries.id = evidence.entry_id
     where evidence.tenant_id = $1 and entries.status = 'active'
     order by evidence.captured_at desc, evidence.id asc`,
    [tenantId],
  );
  return result.rows;
}

export async function getBusinessBrainSignals(
  db: DbClient,
  tenantId: string,
) {
  const result = await db.query<BusinessBrainSignalRow>(
    `select
       (select data from business_profiles where tenant_id = $1)
         as business_profile_data,
       (select updated_at from business_profiles where tenant_id = $1)
         as business_profile_updated_at,
       (select count(*)::int from contacts
         where tenant_id = $1 and status <> 'archived') as contact_count,
       (select count(*)::int from opportunities
         where tenant_id = $1 and lost_reason is null) as opportunity_count,
       (select coalesce(sum(value_cents), 0)::int from opportunities
         where tenant_id = $1 and lost_reason is null) as pipeline_value_cents,
       (select count(*)::int from memberships where tenant_id = $1)
         as member_count,
       (select count(*)::int from workflows
         where tenant_id = $1 and status = 'active') as workflow_count,
       (select count(*)::int from websites where tenant_id = $1)
         as website_count,
       (select count(*)::int from websites
         where tenant_id = $1 and current_published_version_id is not null)
         as published_website_count,
       (select count(*)::int from connectors where tenant_id = $1)
         as connector_count,
       ((select count(*)::int from api_tenant_mappings where tenant_id = $1)
         + (select count(*)::int from connector_proposals where tenant_id = $1))
         as api_asset_count`,
    [tenantId],
  );
  return result.rows[0];
}
