import type { DbClient } from "@/lib/db";
import { toJson } from "@/lib/security";
import type {
  DnsChange,
  DnsRecord,
  DomainConnectionState,
  DomainEvidence,
  DomainProviderKey,
} from "@/modules/domain-connections/schemas";

export type DomainConnectionRow = {
  id: string;
  tenant_id: string;
  normalized_domain: string;
  provider_key: DomainProviderKey;
  provider_label: string;
  state: DomainConnectionState;
  likely_registrar: string | null;
  likely_hosting: string | null;
  certificate_status: string;
  evidence: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type DnsSnapshotRow = {
  id: string;
  tenant_id: string;
  domain_connection_id: string;
  records: string;
  evidence: string;
  captured_at: string;
};

export type DnsChangePlanRow = {
  id: string;
  tenant_id: string;
  domain_connection_id: string;
  dns_snapshot_id: string;
  provider_key: DomainProviderKey;
  status: string;
  proposed_changes: string;
  impact_analysis: string;
  rollback_snapshot: string;
  verification_checks: string;
  expires_at: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export type WebsiteDomainBindingRow = {
  id: string;
  tenant_id: string;
  website_id: string;
  domain_connection_id: string;
  dns_change_plan_id: string;
  published_version_id_at_request: string;
  status: string;
  certificate_status: string;
  safe_error_code: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  verified_at: string | null;
  disconnected_at: string | null;
};

export type DomainVerificationJobRow = {
  id: string;
  tenant_id: string;
  website_domain_binding_id: string;
  status: string;
  attempts: number;
  max_attempts: number;
  next_run_at: string;
  lease_expires_at: string | null;
  correlation_id: string;
  safe_error_code: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
};

export async function upsertDomainConnection(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    normalizedDomain: string;
    providerKey: DomainProviderKey;
    providerLabel: string;
    state: DomainConnectionState;
    likelyRegistrar: string | null;
    likelyHosting: string | null;
    certificateStatus: string;
    evidence: DomainEvidence[];
    createdBy: string;
    now: string;
  },
) {
  const result = await db.query<DomainConnectionRow>(
    `insert into domain_connections (
       id, tenant_id, normalized_domain, provider_key, provider_label, state,
       likely_registrar, likely_hosting, certificate_status, evidence,
       created_by, created_at, updated_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
     on conflict (tenant_id, normalized_domain) do update set
       provider_key = excluded.provider_key,
       provider_label = excluded.provider_label,
       state = excluded.state,
       likely_registrar = excluded.likely_registrar,
       likely_hosting = excluded.likely_hosting,
       certificate_status = excluded.certificate_status,
       evidence = excluded.evidence,
       updated_at = excluded.updated_at
     returning *`,
    [
      input.id,
      input.tenantId,
      input.normalizedDomain,
      input.providerKey,
      input.providerLabel,
      input.state,
      input.likelyRegistrar,
      input.likelyHosting,
      input.certificateStatus,
      toJson(input.evidence),
      input.createdBy,
      input.now,
    ],
  );
  return result.rows[0] ?? null;
}

export async function findDomainConnection(
  db: DbClient,
  tenantId: string,
  connectionId: string,
) {
  const result = await db.query<DomainConnectionRow>(
    "select * from domain_connections where tenant_id = $1 and id = $2",
    [tenantId, connectionId],
  );
  return result.rows[0] ?? null;
}

export async function listDomainConnections(db: DbClient, tenantId: string) {
  const result = await db.query<DomainConnectionRow>(
    `select * from domain_connections
     where tenant_id = $1 order by updated_at desc, id desc`,
    [tenantId],
  );
  return result.rows;
}

export async function updateDomainConnectionState(
  db: DbClient,
  input: {
    tenantId: string;
    connectionId: string;
    state: DomainConnectionState;
    now: string;
  },
) {
  await db.query(
    `update domain_connections set state = $1, updated_at = $2
     where tenant_id = $3 and id = $4`,
    [input.state, input.now, input.tenantId, input.connectionId],
  );
}

export async function insertDnsSnapshot(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    connectionId: string;
    records: DnsRecord[];
    evidence: DomainEvidence[];
    capturedAt: string;
  },
) {
  await db.query(
    `insert into dns_snapshots (
       id, tenant_id, domain_connection_id, records, evidence, captured_at
     ) values ($1, $2, $3, $4, $5, $6)`,
    [
      input.id,
      input.tenantId,
      input.connectionId,
      toJson(input.records),
      toJson(input.evidence),
      input.capturedAt,
    ],
  );
}

export async function findLatestDnsSnapshot(
  db: DbClient,
  tenantId: string,
  connectionId: string,
) {
  const result = await db.query<DnsSnapshotRow>(
    `select * from dns_snapshots
     where tenant_id = $1 and domain_connection_id = $2
     order by captured_at desc, id desc limit 1`,
    [tenantId, connectionId],
  );
  return result.rows[0] ?? null;
}

export async function insertDnsChangePlan(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    connectionId: string;
    snapshotId: string;
    providerKey: DomainProviderKey;
    proposedChanges: DnsChange[];
    impactAnalysis: Record<string, unknown>;
    rollbackSnapshot: DnsRecord[];
    verificationChecks: string[];
    expiresAt: string;
    createdBy: string;
    now: string;
  },
) {
  await db.query(
    `insert into dns_change_plans (
       id, tenant_id, domain_connection_id, dns_snapshot_id, provider_key,
       status, proposed_changes, impact_analysis, rollback_snapshot,
       verification_checks, expires_at, created_by, created_at, updated_at
     ) values ($1, $2, $3, $4, $5, 'awaiting_approval', $6, $7, $8, $9,
               $10, $11, $12, $12)`,
    [
      input.id,
      input.tenantId,
      input.connectionId,
      input.snapshotId,
      input.providerKey,
      toJson(input.proposedChanges),
      toJson(input.impactAnalysis),
      toJson(input.rollbackSnapshot),
      toJson(input.verificationChecks),
      input.expiresAt,
      input.createdBy,
      input.now,
    ],
  );
}

export async function findDnsChangePlan(
  db: DbClient,
  tenantId: string,
  planId: string,
) {
  const result = await db.query<DnsChangePlanRow>(
    "select * from dns_change_plans where tenant_id = $1 and id = $2",
    [tenantId, planId],
  );
  return result.rows[0] ?? null;
}

export async function listDnsChangePlans(db: DbClient, tenantId: string) {
  const result = await db.query<DnsChangePlanRow>(
    `select * from dns_change_plans
     where tenant_id = $1 order by created_at desc, id desc`,
    [tenantId],
  );
  return result.rows;
}

export async function findLatestSimulatedDnsChangePlan(
  db: DbClient,
  tenantId: string,
  connectionId: string,
) {
  const result = await db.query<DnsChangePlanRow>(
    `select * from dns_change_plans
      where tenant_id = $1 and domain_connection_id = $2 and status = 'simulated'
      order by updated_at desc, id desc limit 1`,
    [tenantId, connectionId],
  );
  return result.rows[0] ?? null;
}

export async function updateDnsChangePlanStatus(
  db: DbClient,
  input: { tenantId: string; planId: string; status: string; now: string },
) {
  await db.query(
    `update dns_change_plans set status = $1, updated_at = $2
     where tenant_id = $3 and id = $4`,
    [input.status, input.now, input.tenantId, input.planId],
  );
}

export async function insertDnsPlanApproval(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    planId: string;
    approvalType: "primary" | "second_confirmation";
    actorId: string;
    now: string;
  },
) {
  await db.query(
    `insert into dns_change_approvals (
       id, tenant_id, dns_change_plan_id, approval_type, decision,
       actor_id, created_at
     ) values ($1, $2, $3, $4, 'approved', $5, $6)`,
    [
      input.id,
      input.tenantId,
      input.planId,
      input.approvalType,
      input.actorId,
      input.now,
    ],
  );
}

export async function upsertWebsiteDomainBinding(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    websiteId: string;
    connectionId: string;
    planId: string;
    publishedVersionId: string;
    actorId: string;
    now: string;
  },
) {
  const result = await db.query<WebsiteDomainBindingRow>(
    `insert into website_domain_bindings (
       id, tenant_id, website_id, domain_connection_id, dns_change_plan_id,
       published_version_id_at_request, status, certificate_status,
       safe_error_code, created_by, created_at, updated_at, verified_at,
       disconnected_at
     ) values (
       $1, $2, $3, $4, $5, $6, 'pending_verification', 'pending',
       null, $7, $8, $8, null, null
     )
     on conflict (tenant_id, domain_connection_id) do update set
       website_id = excluded.website_id,
       dns_change_plan_id = excluded.dns_change_plan_id,
       published_version_id_at_request = excluded.published_version_id_at_request,
       status = 'pending_verification',
       certificate_status = 'pending',
       safe_error_code = null,
       updated_at = excluded.updated_at,
       verified_at = null,
       disconnected_at = null
     returning *`,
    [
      input.id,
      input.tenantId,
      input.websiteId,
      input.connectionId,
      input.planId,
      input.publishedVersionId,
      input.actorId,
      input.now,
    ],
  );
  return result.rows[0] ?? null;
}

export async function findWebsiteDomainBinding(
  db: DbClient,
  tenantId: string,
  bindingId: string,
) {
  const result = await db.query<WebsiteDomainBindingRow>(
    "select * from website_domain_bindings where tenant_id = $1 and id = $2",
    [tenantId, bindingId],
  );
  return result.rows[0] ?? null;
}

export async function findWebsiteDomainBindingByConnection(
  db: DbClient,
  tenantId: string,
  connectionId: string,
) {
  const result = await db.query<WebsiteDomainBindingRow>(
    `select * from website_domain_bindings
      where tenant_id = $1 and domain_connection_id = $2`,
    [tenantId, connectionId],
  );
  return result.rows[0] ?? null;
}

export async function listWebsiteDomainBindings(db: DbClient, tenantId: string) {
  const result = await db.query<WebsiteDomainBindingRow>(
    `select * from website_domain_bindings
      where tenant_id = $1 order by updated_at desc, id desc`,
    [tenantId],
  );
  return result.rows;
}

export async function insertDomainVerificationJob(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    bindingId: string;
    correlationId: string;
    actorId: string;
    now: string;
  },
) {
  await db.query(
    `insert into domain_verification_jobs (
       id, tenant_id, website_domain_binding_id, status, attempts,
       max_attempts, next_run_at, lease_expires_at, correlation_id,
       safe_error_code, created_by, created_at, updated_at, completed_at
     ) values ($1, $2, $3, 'queued', 0, 3, $4, null, $5, null, $6, $4, $4, null)`,
    [
      input.id,
      input.tenantId,
      input.bindingId,
      input.now,
      input.correlationId,
      input.actorId,
    ],
  );
}

export async function findDomainVerificationJob(
  db: DbClient,
  tenantId: string,
  jobId: string,
) {
  const result = await db.query<DomainVerificationJobRow>(
    "select * from domain_verification_jobs where tenant_id = $1 and id = $2",
    [tenantId, jobId],
  );
  return result.rows[0] ?? null;
}

export async function markDomainVerificationProcessing(
  db: DbClient,
  input: { tenantId: string; jobId: string; now: string; leaseExpiresAt: string },
) {
  await db.query(
    `update domain_verification_jobs
        set status = 'processing', attempts = attempts + 1,
            lease_expires_at = $1, updated_at = $2
      where tenant_id = $3 and id = $4 and status = 'queued'`,
    [input.leaseExpiresAt, input.now, input.tenantId, input.jobId],
  );
}

export async function completeDomainVerificationJob(
  db: DbClient,
  input: { tenantId: string; jobId: string; now: string },
) {
  await db.query(
    `update domain_verification_jobs
        set status = 'verified', lease_expires_at = null,
            safe_error_code = null, completed_at = $1, updated_at = $1
      where tenant_id = $2 and id = $3 and status = 'processing'`,
    [input.now, input.tenantId, input.jobId],
  );
}

export async function failDomainVerificationJob(
  db: DbClient,
  input: { tenantId: string; jobId: string; errorCode: string; now: string },
) {
  await db.query(
    `update domain_verification_jobs
        set status = 'failed', lease_expires_at = null,
            safe_error_code = $1, completed_at = $2, updated_at = $2
      where tenant_id = $3 and id = $4 and status in ('queued', 'processing')`,
    [input.errorCode, input.now, input.tenantId, input.jobId],
  );
}

export async function markWebsiteDomainBindingBound(
  db: DbClient,
  input: { tenantId: string; bindingId: string; now: string },
) {
  await db.query(
    `update website_domain_bindings
        set status = 'bound', certificate_status = 'available',
            safe_error_code = null, verified_at = $1, updated_at = $1
      where tenant_id = $2 and id = $3 and status = 'pending_verification'`,
    [input.now, input.tenantId, input.bindingId],
  );
}

export async function failWebsiteDomainBinding(
  db: DbClient,
  input: { tenantId: string; bindingId: string; errorCode: string; now: string },
) {
  await db.query(
    `update website_domain_bindings
        set status = 'failed', certificate_status = 'unavailable',
            safe_error_code = $1, updated_at = $2
      where tenant_id = $3 and id = $4 and status = 'pending_verification'`,
    [input.errorCode, input.now, input.tenantId, input.bindingId],
  );
}

export async function markWebsiteDomainBindingDisconnected(
  db: DbClient,
  input: { tenantId: string; bindingId: string; now: string },
) {
  await db.query(
    `update website_domain_bindings
        set status = 'disconnected', disconnected_at = $1, updated_at = $1
      where tenant_id = $2 and id = $3 and status in ('bound', 'failed')`,
    [input.now, input.tenantId, input.bindingId],
  );
}

export async function markDomainConnectionVerified(
  db: DbClient,
  input: { tenantId: string; connectionId: string; now: string },
) {
  await db.query(
    `update domain_connections
        set state = 'verified', certificate_status = 'available', updated_at = $1
      where tenant_id = $2 and id = $3`,
    [input.now, input.tenantId, input.connectionId],
  );
}
