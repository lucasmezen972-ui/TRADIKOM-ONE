import type { DbClient } from "@/lib/db";
import { safeJson } from "@/lib/security";
import { listApiClaimsForProduct } from "@/modules/api-intelligence/repository";
import type { ApiChangeSummary } from "@/modules/api-intelligence/change-monitor/schemas";
import { assertPlatformAdmin } from "@/modules/platform-admin";

type DomainRow = {
  id: string;
  software_id: string;
  software_name: string;
  domain: string;
  approval_status: string;
  decision_reason: string | null;
};

type ProductRow = {
  id: string;
  software_id: string;
  software_name: string;
  name: string;
  version: string;
  authentication_type: string;
  webhook_support: number;
  last_verified_at: string | null;
};

type SourceRow = {
  id: string;
  api_product_id: string | null;
  software_name: string;
  canonical_url: string;
  source_type: string;
  latest_snapshot_id: string | null;
  latest_content_hash: string | null;
  latest_retrieved_at: string | null;
  recheck_schedule_id: string | null;
  recheck_enabled: number | null;
  recheck_interval_seconds: number | null;
  recheck_next_run_at: string | null;
  recheck_last_run_at: string | null;
  recheck_last_status: string | null;
  recheck_failure_count: number | null;
  recheck_last_error_code: string | null;
};

type DiscoveryCandidateRow = {
  id: string;
  software_id: string;
  software_name: string;
  domain_id: string;
  canonical_url: string;
  source_type: string;
  confidence: number;
  discovery_reason: string;
  sitemap_url: string;
  status: string;
  api_source_id: string | null;
  last_seen_at: string;
  decision_reason: string | null;
};

type SchemaRow = {
  id: string;
  api_product_id: string;
  product_name: string;
  schema_name: string;
  evidence_id: string | null;
  claim_status: string | null;
};

type MappingRow = {
  id: string;
  api_product_id: string;
  source_entity: string;
  canonical_entity: string;
  confidence: number;
  approval_status: string;
};

type GlobalMappingRow = {
  id: string;
  api_product_id: string;
  product_name: string;
  source_entity: string;
  canonical_entity: string;
  confidence: number;
  approval_status: string;
};

type CompatibilityRow = {
  id: string;
  api_product_id: string;
  software_name: string;
  desired_automation: string;
  outcome: string;
  result: string;
  created_at: string;
};

type ProposalRow = {
  id: string;
  name: string;
  status: string;
  enabled: number;
  software_name: string;
  contract_status: string | null;
  updated_at: string;
};

type ApprovalRow = {
  id: string;
  connector_proposal_id: string;
  connector_name: string;
  requested_scope: string;
  status: string;
  created_at: string;
};

type ChangeEventRow = {
  id: string;
  product_name: string;
  software_name: string;
  primary_classification: string;
  summary: string;
  requires_approval: number;
  detected_at: string;
  affected_connectors: number;
  affected_tenants: number;
};

type ChangeImpactRow = {
  id: string;
  api_change_event_id: string;
  connector_name: string;
  primary_classification: string;
  status: string;
  upgrade_blocked: number;
  repair_proposal: string;
  contract_test_status: string;
  approval_status: string;
  repair_id: string | null;
  replacement_proposal_id: string | null;
  replacement_version: string | null;
  replacement_status: string | null;
  replacement_contract_status: string | null;
  created_at: string;
};

export async function getApiIntelligenceWorkspace(
  db: DbClient,
  userId: string,
  tenantId: string,
) {
  await assertPlatformAdmin(db, userId, tenantId);

  const domains = await db.query<DomainRow>(
    `select software_domains.id, software_domains.software_id,
            software_directory_entries.canonical_name as software_name,
            software_domains.domain, software_domains.approval_status,
            software_domains.decision_reason
     from software_domains
     join software_directory_entries
       on software_directory_entries.id = software_domains.software_id
     order by software_directory_entries.canonical_name asc,
              software_domains.domain asc`,
  );
  const products = await db.query<ProductRow>(
    `select api_products.id, api_products.software_id,
            software_directory_entries.canonical_name as software_name,
            api_products.name, api_products.version,
            api_products.authentication_type, api_products.webhook_support,
            api_products.last_verified_at
     from api_products
     join software_directory_entries
       on software_directory_entries.id = api_products.software_id
     order by software_directory_entries.canonical_name asc,
              api_products.name asc`,
  );
  const sources = await db.query<SourceRow>(
    `select api_sources.id, api_sources.api_product_id,
            software_directory_entries.canonical_name as software_name,
            api_sources.canonical_url, api_sources.source_type,
            latest.id as latest_snapshot_id,
            latest.content_hash as latest_content_hash,
            latest.retrieved_at as latest_retrieved_at,
            recheck.id as recheck_schedule_id,
            recheck.enabled as recheck_enabled,
            recheck.interval_seconds as recheck_interval_seconds,
            recheck.next_run_at as recheck_next_run_at,
            recheck.last_run_at as recheck_last_run_at,
            recheck.last_status as recheck_last_status,
            recheck.consecutive_failures as recheck_failure_count,
            recheck.last_error_code as recheck_last_error_code
     from api_sources
     join software_directory_entries
       on software_directory_entries.id = api_sources.software_id
     left join api_source_snapshots latest
       on latest.id = (
         select snapshot.id
         from api_source_snapshots snapshot
         where snapshot.source_id = api_sources.id
         order by snapshot.retrieved_at desc, snapshot.created_at desc
         limit 1
       )
     left join api_source_recheck_schedules recheck
       on recheck.source_id = api_sources.id
     order by software_directory_entries.canonical_name asc,
              api_sources.canonical_url asc`,
  );
  const discoveryCandidates = await db.query<DiscoveryCandidateRow>(
    `select api_discovery_candidates.id,
            api_discovery_candidates.software_id,
            software_directory_entries.canonical_name as software_name,
            api_discovery_candidates.domain_id,
            api_discovery_candidates.canonical_url,
            api_discovery_candidates.source_type,
            api_discovery_candidates.confidence,
            api_discovery_candidates.discovery_reason,
            api_discovery_candidates.sitemap_url,
            api_discovery_candidates.status,
            api_discovery_candidates.api_source_id,
            api_discovery_candidates.last_seen_at,
            api_discovery_candidates.decision_reason
     from api_discovery_candidates
     join software_directory_entries
       on software_directory_entries.id = api_discovery_candidates.software_id
     order by
       case api_discovery_candidates.status
         when 'under_review' then 0
         when 'accepted' then 1
         else 2
       end,
       api_discovery_candidates.confidence desc,
       api_discovery_candidates.last_seen_at desc`,
  );
  const schemas = await db.query<SchemaRow>(
    `select api_schemas.id, api_schemas.api_product_id,
            api_products.name as product_name, api_schemas.schema_name,
            api_evidence.id as evidence_id,
            api_claims.approval_status as claim_status
     from api_schemas
     join api_products on api_products.id = api_schemas.api_product_id
     left join api_claims
       on api_claims.subject_type = 'api_schema'
      and api_claims.subject_id = api_schemas.id
     left join api_evidence on api_evidence.claim_id = api_claims.id
     order by api_products.name asc, api_schemas.schema_name asc`,
  );
  const mappings = await db.query<MappingRow>(
    `select id, api_product_id, source_entity, canonical_entity,
            confidence, approval_status
     from api_tenant_mappings
     where tenant_id = $1
     order by created_at desc`,
    [tenantId],
  );
  const compatibilityChecks = await db.query<CompatibilityRow>(
    `select api_compatibility_checks.id,
            api_compatibility_checks.api_product_id,
            software_directory_entries.canonical_name as software_name,
            api_compatibility_checks.desired_automation,
            api_compatibility_checks.outcome,
            api_compatibility_checks.result,
            api_compatibility_checks.created_at
     from api_compatibility_checks
     join software_directory_entries
       on software_directory_entries.id = api_compatibility_checks.software_id
     where api_compatibility_checks.tenant_id = $1
     order by api_compatibility_checks.created_at desc`,
    [tenantId],
  );
  const proposals = await db.query<ProposalRow>(
    `select connector_proposals.id, connector_proposals.name,
            connector_proposals.status, connector_proposals.enabled,
            software_directory_entries.canonical_name as software_name,
            (
              select connector_contract_runs.status
              from connector_contract_runs
              where connector_contract_runs.tenant_id = connector_proposals.tenant_id
                and connector_contract_runs.connector_proposal_id = connector_proposals.id
              order by connector_contract_runs.created_at desc
              limit 1
            ) as contract_status,
            connector_proposals.updated_at
     from connector_proposals
     join software_directory_entries
       on software_directory_entries.id = connector_proposals.software_id
     where connector_proposals.tenant_id = $1
     order by connector_proposals.updated_at desc`,
    [tenantId],
  );
  const approvals = await db.query<ApprovalRow>(
    `select connector_approval_requests.id,
            connector_approval_requests.connector_proposal_id,
            connector_proposals.name as connector_name,
            connector_approval_requests.requested_scope,
            connector_approval_requests.status,
            connector_approval_requests.created_at
     from connector_approval_requests
     join connector_proposals
       on connector_proposals.id = connector_approval_requests.connector_proposal_id
      and connector_proposals.tenant_id = connector_approval_requests.tenant_id
     where connector_approval_requests.tenant_id = $1
     order by connector_approval_requests.created_at desc`,
    [tenantId],
  );
  const changeEvents = await db.query<ChangeEventRow>(
    `select api_change_events.id,
            api_products.name as product_name,
            software_directory_entries.canonical_name as software_name,
            api_change_events.primary_classification,
            api_change_events.summary,
            api_change_events.requires_approval,
            api_change_events.detected_at,
            count(api_change_impacts.id)::int as affected_connectors,
            count(distinct api_change_impacts.tenant_id)::int as affected_tenants
     from api_change_events
     join api_products on api_products.id = api_change_events.api_product_id
     join software_directory_entries
       on software_directory_entries.id = api_products.software_id
     left join api_change_impacts
       on api_change_impacts.api_change_event_id = api_change_events.id
     group by api_change_events.id, api_change_events.primary_classification,
              api_change_events.summary, api_change_events.requires_approval,
              api_change_events.detected_at, api_products.name,
              software_directory_entries.canonical_name
     order by api_change_events.detected_at desc
     limit 50`,
  );
  const changeImpacts = await db.query<ChangeImpactRow>(
    `select api_change_impacts.id,
            api_change_impacts.api_change_event_id,
            connector_proposals.name as connector_name,
            api_change_events.primary_classification,
            api_change_impacts.status,
            api_change_impacts.upgrade_blocked,
            api_change_impacts.repair_proposal,
            api_change_impacts.contract_test_status,
            api_change_impacts.approval_status,
            connector_repair_proposals.id as repair_id,
            replacement_proposals.id as replacement_proposal_id,
            replacement_proposals.version as replacement_version,
            replacement_proposals.status as replacement_status,
            (
              select connector_contract_runs.status
              from connector_contract_runs
              where connector_contract_runs.tenant_id = api_change_impacts.tenant_id
                and connector_contract_runs.connector_proposal_id = replacement_proposals.id
              order by connector_contract_runs.created_at desc
              limit 1
            ) as replacement_contract_status,
            api_change_impacts.created_at
     from api_change_impacts
     join api_change_events
       on api_change_events.id = api_change_impacts.api_change_event_id
     join connector_proposals
       on connector_proposals.id = api_change_impacts.connector_proposal_id
      and connector_proposals.tenant_id = api_change_impacts.tenant_id
     left join connector_repair_proposals
       on connector_repair_proposals.api_change_impact_id = api_change_impacts.id
      and connector_repair_proposals.tenant_id = api_change_impacts.tenant_id
     left join connector_proposals replacement_proposals
       on replacement_proposals.id = connector_repair_proposals.replacement_connector_proposal_id
      and replacement_proposals.tenant_id = connector_repair_proposals.tenant_id
     where api_change_impacts.tenant_id = $1
     order by api_change_impacts.created_at desc`,
    [tenantId],
  );
  const globalMappings = await db.query<GlobalMappingRow>(
    `select api_global_mappings.id,
            api_global_mappings.api_product_id,
            api_products.name as product_name,
            api_global_mappings.source_entity,
            api_global_mappings.canonical_entity,
            api_global_mappings.confidence,
            api_global_mappings.approval_status
     from api_global_mappings
     join api_products on api_products.id = api_global_mappings.api_product_id
     where api_global_mappings.approval_status = 'approved'
     order by api_products.name asc, api_global_mappings.source_entity asc`,
  );
  const claims = await listApiClaimsForProduct(db);

  return {
    domains: domains.rows.map((row) => ({
      id: row.id,
      softwareId: row.software_id,
      softwareName: row.software_name,
      domain: row.domain,
      status: row.approval_status,
      reason: row.decision_reason ?? undefined,
    })),
    products: products.rows.map((row) => ({
      id: row.id,
      softwareId: row.software_id,
      softwareName: row.software_name,
      name: row.name,
      version: row.version,
      authenticationType: row.authentication_type,
      webhookSupport: Boolean(row.webhook_support),
      lastVerifiedAt: row.last_verified_at ?? undefined,
    })),
    sources: sources.rows.map((row) => ({
      id: row.id,
      apiProductId: row.api_product_id ?? undefined,
      softwareName: row.software_name,
      url: row.canonical_url,
      sourceType: row.source_type,
      latestSnapshotId: row.latest_snapshot_id ?? undefined,
      latestContentHash: row.latest_content_hash ?? undefined,
      latestRetrievedAt: row.latest_retrieved_at ?? undefined,
      recheck: row.recheck_schedule_id
        ? {
            id: row.recheck_schedule_id,
            enabled: Boolean(row.recheck_enabled),
            intervalSeconds: row.recheck_interval_seconds ?? 86_400,
            nextRunAt: row.recheck_next_run_at ?? undefined,
            lastRunAt: row.recheck_last_run_at ?? undefined,
            status: row.recheck_last_status ?? "disabled",
            failureCount: row.recheck_failure_count ?? 0,
            lastErrorCode: row.recheck_last_error_code ?? undefined,
          }
        : undefined,
    })),
    discoveryCandidates: discoveryCandidates.rows.map((row) => ({
      id: row.id,
      softwareId: row.software_id,
      softwareName: row.software_name,
      domainId: row.domain_id,
      url: row.canonical_url,
      sourceType: row.source_type,
      confidence: row.confidence,
      reason: row.discovery_reason,
      sitemapUrl: row.sitemap_url,
      status: row.status,
      apiSourceId: row.api_source_id ?? undefined,
      lastSeenAt: row.last_seen_at,
      decisionReason: row.decision_reason ?? undefined,
    })),
    schemas: schemas.rows.map((row) => ({
      id: row.id,
      apiProductId: row.api_product_id,
      productName: row.product_name,
      name: row.schema_name,
      evidenceId: row.evidence_id ?? undefined,
      claimStatus: row.claim_status ?? undefined,
    })),
    mappings: mappings.rows.map((row) => ({
      id: row.id,
      apiProductId: row.api_product_id,
      sourceEntity: row.source_entity,
      canonicalEntity: row.canonical_entity,
      confidence: row.confidence,
      status: row.approval_status,
    })),
    globalMappings: globalMappings.rows.map((row) => ({
      id: row.id,
      apiProductId: row.api_product_id,
      productName: row.product_name,
      sourceEntity: row.source_entity,
      canonicalEntity: row.canonical_entity,
      confidence: row.confidence,
      status: row.approval_status,
    })),
    compatibilityChecks: compatibilityChecks.rows.map((row) => ({
      id: row.id,
      apiProductId: row.api_product_id,
      softwareName: row.software_name,
      desiredAutomation: row.desired_automation,
      outcome: row.outcome,
      result: safeJson<Record<string, unknown>>(row.result, {}),
      createdAt: row.created_at,
    })),
    proposals: proposals.rows.map((row) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      enabled: Boolean(row.enabled),
      softwareName: row.software_name,
      contractStatus: row.contract_status ?? undefined,
      updatedAt: row.updated_at,
    })),
    approvals: approvals.rows.map((row) => ({
      id: row.id,
      proposalId: row.connector_proposal_id,
      connectorName: row.connector_name,
      requestedScope: row.requested_scope,
      status: row.status,
      createdAt: row.created_at,
    })),
    changeEvents: changeEvents.rows.map((row) => ({
      id: row.id,
      productName: row.product_name,
      softwareName: row.software_name,
      primaryClassification: row.primary_classification,
      summary: safeJson<ApiChangeSummary | null>(row.summary, null),
      requiresApproval: Boolean(row.requires_approval),
      affectedConnectorCount: row.affected_connectors,
      affectedTenantCount: row.affected_tenants,
      detectedAt: row.detected_at,
    })),
    changeImpacts: changeImpacts.rows.map((row) => ({
      id: row.id,
      changeEventId: row.api_change_event_id,
      connectorName: row.connector_name,
      primaryClassification: row.primary_classification,
      status: row.status,
      upgradeBlocked: Boolean(row.upgrade_blocked),
      repairProposal: safeJson<Record<string, unknown>>(row.repair_proposal, {}),
      contractTestStatus: row.contract_test_status,
      approvalStatus: row.approval_status,
      repairId: row.repair_id ?? undefined,
      replacementProposalId: row.replacement_proposal_id ?? undefined,
      replacementVersion: row.replacement_version ?? undefined,
      replacementStatus: row.replacement_status ?? undefined,
      replacementContractStatus: row.replacement_contract_status ?? undefined,
      createdAt: row.created_at,
    })),
    claims,
  };
}
