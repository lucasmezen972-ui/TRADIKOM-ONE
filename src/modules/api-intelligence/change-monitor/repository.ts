import type { DbClient } from "@/lib/db";
import { safeJson, toJson } from "@/lib/security";
import type {
  ApiChangeClassification,
  ApiChangeSummary,
} from "@/modules/api-intelligence/change-monitor/schemas";

export type ApiChangeEventRow = {
  id: string;
  api_product_id: string;
  source_id: string;
  previous_snapshot_id: string;
  current_snapshot_id: string;
  primary_classification: ApiChangeClassification;
  classifications: string;
  summary: string;
  requires_approval: number;
  detected_at: string;
};

export type ApiChangeImpactRow = {
  id: string;
  tenant_id: string;
  api_change_event_id: string;
  connector_proposal_id: string;
  contract_run_id: string | null;
  status: string;
  upgrade_blocked: number;
  repair_proposal: string;
  contract_test_status: string;
  contract_test_results: string;
  approval_status: string;
  decided_by: string | null;
  decision_reason: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
};

export async function findApiChangeEventBySnapshots(
  db: DbClient,
  previousSnapshotId: string,
  currentSnapshotId: string,
) {
  const result = await db.query<ApiChangeEventRow>(
    `select * from api_change_events
     where previous_snapshot_id = $1 and current_snapshot_id = $2`,
    [previousSnapshotId, currentSnapshotId],
  );
  return result.rows[0] ?? null;
}

export async function insertApiChangeEvent(
  db: DbClient,
  input: {
    id: string;
    apiProductId: string;
    sourceId: string;
    previousSnapshotId: string;
    currentSnapshotId: string;
    primaryClassification: ApiChangeClassification;
    classifications: ApiChangeClassification[];
    summary: ApiChangeSummary;
    requiresApproval: boolean;
    detectedAt: string;
  },
) {
  await db.query(
    `insert into api_change_events (
       id, api_product_id, source_id, previous_snapshot_id,
       current_snapshot_id, primary_classification, classifications,
       summary, requires_approval, detected_at, created_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
    [
      input.id,
      input.apiProductId,
      input.sourceId,
      input.previousSnapshotId,
      input.currentSnapshotId,
      input.primaryClassification,
      toJson(input.classifications),
      toJson(input.summary),
      input.requiresApproval ? 1 : 0,
      input.detectedAt,
    ],
  );
}

export async function listConnectorProposalsForApiProduct(
  db: DbClient,
  apiProductId: string,
) {
  const result = await db.query<{
    id: string;
    tenant_id: string;
    name: string;
    version: string;
    manifest: string;
  }>(
    `select id, tenant_id, name, version, manifest
     from connector_proposals
     where api_product_id = $1
     order by tenant_id asc, id asc`,
    [apiProductId],
  );
  return result.rows;
}

export async function insertApiChangeContractRun(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    proposalId: string;
    connectorVersion: string;
    apiVersion: string;
    status: "passed" | "failed";
    results: unknown;
    safeLogs: string[];
    createdAt: string;
  },
) {
  await db.query(
    `insert into connector_contract_runs (
       id, tenant_id, connector_proposal_id, connector_version, api_version,
       test_suite_version, environment, status, results, safe_logs, created_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      input.id,
      input.tenantId,
      input.proposalId,
      input.connectorVersion,
      input.apiVersion,
      "api-change-1",
      "change_monitor",
      input.status,
      toJson(input.results),
      toJson(input.safeLogs),
      input.createdAt,
    ],
  );
}

export async function insertApiChangeImpact(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    changeEventId: string;
    proposalId: string;
    contractRunId: string;
    repairProposal: unknown;
    contractTestStatus: "passed" | "failed";
    contractTestResults: unknown;
    createdAt: string;
  },
) {
  await db.query(
    `insert into api_change_impacts (
       id, tenant_id, api_change_event_id, connector_proposal_id,
       contract_run_id, status, upgrade_blocked, repair_proposal,
       contract_test_status, contract_test_results, approval_status,
       decided_by, decision_reason, decided_at, created_at, updated_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
               $12, $13, $14, $15, $15)`,
    [
      input.id,
      input.tenantId,
      input.changeEventId,
      input.proposalId,
      input.contractRunId,
      "review_required",
      1,
      toJson(input.repairProposal),
      input.contractTestStatus,
      toJson(input.contractTestResults),
      "pending",
      null,
      null,
      null,
      input.createdAt,
    ],
  );
}

export async function blockConnectorForApiChange(
  db: DbClient,
  input: { tenantId: string; proposalId: string; updatedAt: string },
) {
  await db.query(
    `update connector_proposals
     set status = $1, enabled = 0, updated_at = $2
     where tenant_id = $3 and id = $4`,
    ["change_review_required", input.updatedAt, input.tenantId, input.proposalId],
  );
  await db.query(
    `update private_connect_store_entries
     set verification_status = $1, updated_at = $2
     where tenant_id = $3 and connector_proposal_id = $4`,
    ["change_review_required", input.updatedAt, input.tenantId, input.proposalId],
  );
}

export async function findApiChangeImpact(
  db: DbClient,
  tenantId: string,
  impactId: string,
) {
  const result = await db.query<ApiChangeImpactRow>(
    "select * from api_change_impacts where tenant_id = $1 and id = $2",
    [tenantId, impactId],
  );
  return result.rows[0] ?? null;
}

export async function decideApiChangeImpact(
  db: DbClient,
  input: {
    tenantId: string;
    impactId: string;
    decision: "approved" | "rejected";
    reason: string;
    decidedBy: string;
    decidedAt: string;
  },
) {
  await db.query(
    `update api_change_impacts
     set status = $1, approval_status = $2, decided_by = $3,
         decision_reason = $4, decided_at = $5, updated_at = $5
     where tenant_id = $6 and id = $7 and approval_status = 'pending'`,
    [
      input.decision === "approved" ? "repair_approved" : "repair_rejected",
      input.decision,
      input.decidedBy,
      input.reason,
      input.decidedAt,
      input.tenantId,
      input.impactId,
    ],
  );
}

export async function listPendingApiChangeImpacts(
  db: DbClient,
  tenantId: string,
) {
  const result = await db.query<{
    id: string;
    connector_name: string;
    classification: string;
  }>(
    `select api_change_impacts.id,
            connector_proposals.name as connector_name,
            api_change_events.primary_classification as classification
     from api_change_impacts
     join connector_proposals
       on connector_proposals.id = api_change_impacts.connector_proposal_id
      and connector_proposals.tenant_id = api_change_impacts.tenant_id
     join api_change_events
       on api_change_events.id = api_change_impacts.api_change_event_id
     where api_change_impacts.tenant_id = $1
       and api_change_impacts.status in ('review_required', 'repair_approved')
       and api_change_impacts.upgrade_blocked = 1
     order by api_change_impacts.created_at desc`,
    [tenantId],
  );
  return result.rows;
}

export function mapApiChangeEvent(row: ApiChangeEventRow) {
  return {
    id: row.id,
    apiProductId: row.api_product_id,
    sourceId: row.source_id,
    previousSnapshotId: row.previous_snapshot_id,
    currentSnapshotId: row.current_snapshot_id,
    primaryClassification: row.primary_classification,
    classifications: safeJson<ApiChangeClassification[]>(row.classifications, []),
    summary: safeJson<ApiChangeSummary | null>(row.summary, null),
    requiresApproval: Boolean(row.requires_approval),
    detectedAt: row.detected_at,
  };
}
