import type { DbClient } from "@/lib/db";
import { toJson } from "@/lib/security";

export type UniversalConnectorCandidateRow = {
  store_entry_id: string;
  proposal_id: string;
  verification_status: string;
  installation_status: string;
  proposal_status: string;
  proposal_enabled: number;
  connector_name: string;
  connector_version: string;
  manifest: string;
  software_name: string;
  vendor: string;
  industries: string;
  api_product_id: string;
  api_version: string;
  api_last_verified_at: string | null;
  tenant_industry: string;
  contract_run_id: string | null;
  contract_status: string | null;
  contract_created_at: string | null;
};

export type ConnectorInstallationPlanRow = {
  id: string;
  store_entry_id: string;
  connector_proposal_id: string;
  connector_name: string;
  software_name: string;
  fingerprint: string;
  record_status: "current" | "superseded";
  enabled: number;
  installation_mode: "sandbox_only";
  tenant_industry: string;
  industry_match: "aligned" | "not_documented";
  capabilities_snapshot: string;
  evidence_summary: string;
  blockers: string;
  version: number | string;
  supersedes_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

const candidateSelect = `
  select store.id as store_entry_id,
         proposal.id as proposal_id,
         store.verification_status,
         store.installation_status,
         proposal.status as proposal_status,
         proposal.enabled as proposal_enabled,
         proposal.name as connector_name,
         proposal.version as connector_version,
         proposal.manifest,
         software.canonical_name as software_name,
         software.vendor,
         software.industries,
         product.id as api_product_id,
         product.version as api_version,
         product.last_verified_at as api_last_verified_at,
         tenants.category as tenant_industry,
         (
           select run.id from connector_contract_runs run
           where run.tenant_id = store.tenant_id
             and run.connector_proposal_id = proposal.id
           order by run.created_at desc limit 1
         ) as contract_run_id,
         (
           select run.status from connector_contract_runs run
           where run.tenant_id = store.tenant_id
             and run.connector_proposal_id = proposal.id
           order by run.created_at desc limit 1
         ) as contract_status,
         (
           select run.created_at from connector_contract_runs run
           where run.tenant_id = store.tenant_id
             and run.connector_proposal_id = proposal.id
           order by run.created_at desc limit 1
         ) as contract_created_at
  from private_connect_store_entries store
  join connector_proposals proposal
    on proposal.tenant_id = store.tenant_id
   and proposal.id = store.connector_proposal_id
  join software_directory_entries software on software.id = proposal.software_id
  join api_products product on product.id = proposal.api_product_id
  join tenants on tenants.id = store.tenant_id`;

export async function listUniversalConnectorCandidates(
  db: DbClient,
  tenantId: string,
) {
  const result = await db.query<UniversalConnectorCandidateRow>(
    `${candidateSelect}
     where store.tenant_id = $1
     order by proposal.name asc
     limit 100`,
    [tenantId],
  );
  return result.rows;
}

export async function findUniversalConnectorCandidate(
  db: DbClient,
  tenantId: string,
  storeEntryId: string,
) {
  const result = await db.query<UniversalConnectorCandidateRow>(
    `${candidateSelect}
     where store.tenant_id = $1 and store.id = $2`,
    [tenantId, storeEntryId],
  );
  return result.rows[0] ?? null;
}

export async function listConnectorInstallationPlans(
  db: DbClient,
  tenantId: string,
) {
  const result = await db.query<ConnectorInstallationPlanRow>(
    `select plan.*, proposal.name as connector_name,
            software.canonical_name as software_name
     from connector_installation_plans plan
     join connector_proposals proposal
       on proposal.tenant_id = plan.tenant_id
      and proposal.id = plan.connector_proposal_id
     join software_directory_entries software on software.id = proposal.software_id
     where plan.tenant_id = $1 and plan.record_status = 'current'
     order by plan.updated_at desc, plan.id asc
     limit 100`,
    [tenantId],
  );
  return result.rows;
}

export async function findCurrentConnectorInstallationPlan(
  db: DbClient,
  tenantId: string,
  storeEntryId: string,
) {
  const result = await db.query<ConnectorInstallationPlanRow>(
    `select plan.*, proposal.name as connector_name,
            software.canonical_name as software_name
     from connector_installation_plans plan
     join connector_proposals proposal
       on proposal.tenant_id = plan.tenant_id
      and proposal.id = plan.connector_proposal_id
     join software_directory_entries software on software.id = proposal.software_id
     where plan.tenant_id = $1 and plan.store_entry_id = $2
       and plan.record_status = 'current'`,
    [tenantId, storeEntryId],
  );
  return result.rows[0] ?? null;
}

export async function getNextConnectorInstallationPlanVersion(
  db: DbClient,
  tenantId: string,
  storeEntryId: string,
) {
  const result = await db.query<{ version: number | string }>(
    `select coalesce(max(version), 0) + 1 as version
     from connector_installation_plans
     where tenant_id = $1 and store_entry_id = $2`,
    [tenantId, storeEntryId],
  );
  return Number(result.rows[0]?.version ?? 1);
}

export async function supersedeConnectorInstallationPlan(
  db: DbClient,
  tenantId: string,
  planId: string,
  now: string,
) {
  const result = await db.query<{ id: string }>(
    `update connector_installation_plans
     set record_status = 'superseded', updated_at = $3
     where tenant_id = $1 and id = $2 and record_status = 'current'
     returning id`,
    [tenantId, planId, now],
  );
  return result.rows[0] ?? null;
}

export async function insertConnectorInstallationPlan(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    storeEntryId: string;
    proposalId: string;
    fingerprint: string;
    tenantIndustry: string;
    industryMatch: "aligned" | "not_documented";
    capabilities: unknown[];
    evidence: Record<string, unknown>;
    blockers: string[];
    version: number;
    supersedesId?: string;
    createdBy: string;
    now: string;
  },
) {
  await db.query(
    `insert into connector_installation_plans (
       id, tenant_id, store_entry_id, connector_proposal_id, fingerprint,
       record_status, enabled, installation_mode, tenant_industry,
       industry_match, capabilities_snapshot, evidence_summary, blockers,
       version, supersedes_id, created_by, created_at, updated_at
     ) values (
       $1, $2, $3, $4, $5, 'current', 0, 'sandbox_only', $6, $7, $8,
       $9, $10, $11, $12, $13, $14, $14
     )`,
    [
      input.id,
      input.tenantId,
      input.storeEntryId,
      input.proposalId,
      input.fingerprint,
      input.tenantIndustry,
      input.industryMatch,
      toJson(input.capabilities),
      toJson(input.evidence),
      toJson(input.blockers),
      input.version,
      input.supersedesId ?? null,
      input.createdBy,
      input.now,
    ],
  );
}
