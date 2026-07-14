import type { DbClient } from "@/lib/db";
import { safeJson, toJson } from "@/lib/security";
import type { ConnectorManifest } from "@/modules/connector-copilot/schemas";

export type ConnectorProposalRow = {
  id: string;
  tenant_id: string;
  software_id: string;
  api_product_id: string;
  name: string;
  version: string;
  status: string;
  enabled: number;
  manifest: string;
  unresolved_questions: string;
  risk_assessment: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

export async function insertConnectorProposal(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    softwareId: string;
    apiProductId: string;
    name: string;
    manifest: ConnectorManifest;
    unresolvedQuestions: string[];
    riskAssessment: Record<string, unknown>;
    createdBy: string;
    createdAt: string;
  },
) {
  await db.query(
    `insert into connector_proposals (
       id, tenant_id, software_id, api_product_id, name, version, status,
       enabled, manifest, unresolved_questions, risk_assessment, created_by,
       created_at, updated_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
    [
      input.id,
      input.tenantId,
      input.softwareId,
      input.apiProductId,
      input.name,
      input.manifest.version,
      "static_checks_passed",
      0,
      toJson(input.manifest),
      toJson(input.unresolvedQuestions),
      toJson(input.riskAssessment),
      input.createdBy,
      input.createdAt,
      input.createdAt,
    ],
  );
}

export async function findConnectorProposal(
  db: DbClient,
  tenantId: string,
  proposalId: string,
) {
  const result = await db.query<ConnectorProposalRow>(
    "select * from connector_proposals where tenant_id = $1 and id = $2",
    [tenantId, proposalId],
  );
  return result.rows[0] ?? null;
}

export async function updateConnectorProposalStatus(
  db: DbClient,
  input: { tenantId: string; proposalId: string; status: string; updatedAt: string },
) {
  await db.query(
    `update connector_proposals set status = $1, enabled = 0, updated_at = $2
     where tenant_id = $3 and id = $4`,
    [input.status, input.updatedAt, input.tenantId, input.proposalId],
  );
}

export async function insertContractRun(
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
      "contract-1",
      "mock",
      input.status,
      toJson(input.results),
      toJson(input.safeLogs),
      input.createdAt,
    ],
  );
}

export async function findLatestContractRun(
  db: DbClient,
  tenantId: string,
  proposalId: string,
) {
  const result = await db.query<{ status: string; created_at: string }>(
    `select status, created_at from connector_contract_runs
     where tenant_id = $1 and connector_proposal_id = $2
     order by created_at desc limit 1`,
    [tenantId, proposalId],
  );
  return result.rows[0] ?? null;
}

export async function insertApprovalRequest(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    proposalId: string;
    submittedBy: string;
    createdAt: string;
  },
) {
  await db.query(
    `insert into connector_approval_requests (
       id, tenant_id, connector_proposal_id, requested_scope, status,
       submitted_by, decided_by, decision_reason, created_at, decided_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      input.id,
      input.tenantId,
      input.proposalId,
      "sandbox",
      "pending",
      input.submittedBy,
      null,
      null,
      input.createdAt,
      null,
    ],
  );
}

export async function findApprovalRequest(
  db: DbClient,
  tenantId: string,
  approvalId: string,
) {
  const result = await db.query<{
    id: string;
    connector_proposal_id: string;
    status: string;
    requested_scope: string;
  }>(
    "select * from connector_approval_requests where tenant_id = $1 and id = $2",
    [tenantId, approvalId],
  );
  return result.rows[0] ?? null;
}

export async function decideApprovalRequest(
  db: DbClient,
  input: {
    tenantId: string;
    approvalId: string;
    status: "approved" | "rejected";
    decidedBy: string;
    reason: string;
    decidedAt: string;
  },
) {
  await db.query(
    `update connector_approval_requests
     set status = $1, decided_by = $2, decision_reason = $3, decided_at = $4
     where tenant_id = $5 and id = $6 and status = 'pending'`,
    [
      input.status,
      input.decidedBy,
      input.reason,
      input.decidedAt,
      input.tenantId,
      input.approvalId,
    ],
  );
}

export async function upsertConnectStoreEntry(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    proposalId: string;
    lastTestedAt: string;
    knownLimitations: string[];
    createdAt: string;
  },
) {
  await db.query(
    `insert into private_connect_store_entries (
       id, tenant_id, connector_proposal_id, verification_status,
       installation_status, last_tested_at, known_limitations, created_at, updated_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     on conflict (tenant_id, connector_proposal_id) do update set
       verification_status = excluded.verification_status,
       last_tested_at = excluded.last_tested_at,
       known_limitations = excluded.known_limitations,
       updated_at = excluded.updated_at`,
    [
      input.id,
      input.tenantId,
      input.proposalId,
      "approved_for_sandbox",
      "not_installed",
      input.lastTestedAt,
      toJson(input.knownLimitations),
      input.createdAt,
      input.createdAt,
    ],
  );
}

export async function listConnectStoreEntries(db: DbClient, tenantId: string) {
  const result = await db.query<{
    id: string;
    verification_status: string;
    installation_status: string;
    last_tested_at: string;
    known_limitations: string;
    proposal_id: string;
    connector_name: string;
    connector_version: string;
    manifest: string;
    software_name: string;
    vendor: string;
    api_version: string;
  }>(
    `select private_connect_store_entries.id,
            private_connect_store_entries.verification_status,
            private_connect_store_entries.installation_status,
            private_connect_store_entries.last_tested_at,
            private_connect_store_entries.known_limitations,
            connector_proposals.id as proposal_id,
            connector_proposals.name as connector_name,
            connector_proposals.version as connector_version,
            connector_proposals.manifest,
            software_directory_entries.canonical_name as software_name,
            software_directory_entries.vendor,
            api_products.version as api_version
     from private_connect_store_entries
     join connector_proposals on connector_proposals.id = private_connect_store_entries.connector_proposal_id
       and connector_proposals.tenant_id = private_connect_store_entries.tenant_id
     join software_directory_entries on software_directory_entries.id = connector_proposals.software_id
     join api_products on api_products.id = connector_proposals.api_product_id
     where private_connect_store_entries.tenant_id = $1
     order by connector_proposals.name asc`,
    [tenantId],
  );
  return result.rows.map((row) => ({
    id: row.id,
    proposalId: row.proposal_id,
    connectorName: row.connector_name,
    connectorVersion: row.connector_version,
    softwareName: row.software_name,
    vendor: row.vendor,
    apiVersion: row.api_version,
    verificationStatus: row.verification_status,
    installationStatus: row.installation_status,
    lastTestedAt: row.last_tested_at,
    knownLimitations: safeJson<string[]>(row.known_limitations, []),
    manifest: safeJson<ConnectorManifest | null>(row.manifest, null),
  }));
}
