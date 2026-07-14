import type { DbClient } from "@/lib/db";

export async function readApiIntelligenceObservability(
  db: DbClient,
  tenantId: string,
  now = new Date(),
) {
  const nowValue = now.toISOString();
  const recentSince = new Date(now.getTime() - 24 * 60 * 60 * 1_000).toISOString();
  const global = await db.query<{
    approved_domains: number;
    official_sources: number;
    scheduled_sources: number;
    due_rechecks: number;
    retrying_rechecks: number;
    blocked_rechecks: number;
    pending_candidates: number;
    pending_claims: number;
    changes_24h: number;
  }>(
    `select
       (select count(*)::int from software_domains
        where approval_status = 'approved') as approved_domains,
       (select count(*)::int from api_sources
        where source_classification = 'official') as official_sources,
       (select count(*)::int from api_source_recheck_schedules
        where enabled = 1) as scheduled_sources,
       (select count(*)::int from api_source_recheck_schedules
        where enabled = 1 and next_run_at <= $1) as due_rechecks,
       (select count(*)::int from api_source_recheck_schedules
        where last_status = 'retrying') as retrying_rechecks,
       (select count(*)::int from api_source_recheck_schedules
        where last_status = 'blocked') as blocked_rechecks,
       (select count(*)::int from api_discovery_candidates
        where status = 'under_review') as pending_candidates,
       (select count(*)::int from api_claims
        where approval_status = 'under_review') as pending_claims,
       (select count(*)::int from api_change_events
        where detected_at >= $2) as changes_24h`,
    [nowValue, recentSince],
  );
  const tenant = await db.query<{
    pending_mappings: number;
    blocked_impacts: number;
    pending_repair_decisions: number;
    generated_repairs: number;
    pending_sandbox_approvals: number;
    failed_contracts_24h: number;
    audited_actions_24h: number;
  }>(
    `select
       (select count(*)::int from api_tenant_mappings
        where tenant_id = $1 and approval_status = 'pending')
          as pending_mappings,
       (select count(*)::int from api_change_impacts
        where tenant_id = $1 and upgrade_blocked = 1)
          as blocked_impacts,
       (select count(*)::int from api_change_impacts
        where tenant_id = $1 and approval_status = 'pending')
          as pending_repair_decisions,
       (select count(*)::int from connector_repair_proposals
        where tenant_id = $1) as generated_repairs,
       (select count(*)::int from connector_approval_requests
        where tenant_id = $1 and status = 'pending')
          as pending_sandbox_approvals,
       (select count(*)::int from connector_contract_runs
        where tenant_id = $1 and status = 'failed' and created_at >= $2)
          as failed_contracts_24h,
       (select count(*)::int from audit_logs
        where tenant_id = $1 and action like 'api_intelligence.%'
          and created_at >= $2) as audited_actions_24h`,
    [tenantId, recentSince],
  );
  return {
    capturedAt: nowValue,
    global: mapGlobal(global.rows[0]),
    tenant: mapTenant(tenant.rows[0]),
  };
}

function mapGlobal(row: {
  approved_domains: number;
  official_sources: number;
  scheduled_sources: number;
  due_rechecks: number;
  retrying_rechecks: number;
  blocked_rechecks: number;
  pending_candidates: number;
  pending_claims: number;
  changes_24h: number;
} | undefined) {
  return {
    approvedDomains: row?.approved_domains ?? 0,
    officialSources: row?.official_sources ?? 0,
    scheduledSources: row?.scheduled_sources ?? 0,
    dueRechecks: row?.due_rechecks ?? 0,
    retryingRechecks: row?.retrying_rechecks ?? 0,
    blockedRechecks: row?.blocked_rechecks ?? 0,
    pendingCandidates: row?.pending_candidates ?? 0,
    pendingClaims: row?.pending_claims ?? 0,
    changes24h: row?.changes_24h ?? 0,
  };
}

function mapTenant(row: {
  pending_mappings: number;
  blocked_impacts: number;
  pending_repair_decisions: number;
  generated_repairs: number;
  pending_sandbox_approvals: number;
  failed_contracts_24h: number;
  audited_actions_24h: number;
} | undefined) {
  return {
    pendingMappings: row?.pending_mappings ?? 0,
    blockedImpacts: row?.blocked_impacts ?? 0,
    pendingRepairDecisions: row?.pending_repair_decisions ?? 0,
    generatedRepairs: row?.generated_repairs ?? 0,
    pendingSandboxApprovals: row?.pending_sandbox_approvals ?? 0,
    failedContracts24h: row?.failed_contracts_24h ?? 0,
    auditedActions24h: row?.audited_actions_24h ?? 0,
  };
}
