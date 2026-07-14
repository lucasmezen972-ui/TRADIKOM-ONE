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
