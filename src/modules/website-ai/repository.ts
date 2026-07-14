import type { DbClient } from "@/lib/db";
import type { WebsiteAiEvidenceCandidate } from "@/modules/website-ai/rules";

export type WebsiteAiProposalStatus =
  | "proposed"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "applied"
  | "superseded"
  | "stale";

export type WebsiteAiProposalRow = {
  id: string;
  tenant_id: string;
  website_id: string;
  section_id: string;
  proposal_key: string;
  fingerprint: string;
  proposal_type: "seo_copy" | "faq_content" | "accessibility_copy";
  title: string;
  rationale: string;
  expected_gain: string;
  risk_summary: string;
  proposed_title: string;
  proposed_body: string;
  original_content_hash: string;
  status: WebsiteAiProposalStatus;
  version: number;
  supersedes_id: string | null;
  generation_version: string;
  created_by: string;
  decided_by: string | null;
  decision_reason: string | null;
  decided_at: string | null;
  applied_by: string | null;
  applied_at: string | null;
  created_at: string;
  updated_at: string;
};

export type WebsiteAiEvidenceRow = {
  id: string;
  tenant_id: string;
  proposal_id: string;
  evidence_type: WebsiteAiEvidenceCandidate["type"];
  evidence_ref: string;
  label: string;
  observed_value: string;
  captured_at: string;
  created_at: string;
};

export async function findWebsiteAiProposalByFingerprint(
  db: DbClient,
  tenantId: string,
  proposalKey: string,
  fingerprint: string,
) {
  const result = await db.query<{ id: string }>(
    `select id from website_ai_proposals
     where tenant_id = $1 and proposal_key = $2 and fingerprint = $3`,
    [tenantId, proposalKey, fingerprint],
  );
  return result.rows[0] ?? null;
}

export async function getNextWebsiteAiProposalVersion(
  db: DbClient,
  tenantId: string,
  proposalKey: string,
) {
  const result = await db.query<{ version: number | string }>(
    `select coalesce(max(version), 0)::int + 1 as version
     from website_ai_proposals where tenant_id = $1 and proposal_key = $2`,
    [tenantId, proposalKey],
  );
  return Number(result.rows[0]?.version ?? 1);
}

export async function supersedeOpenWebsiteAiProposals(
  db: DbClient,
  tenantId: string,
  proposalKey: string,
  now: string,
) {
  const result = await db.query<{ id: string }>(
    `update website_ai_proposals
     set status = 'superseded', updated_at = $3
     where tenant_id = $1 and proposal_key = $2
       and status in ('proposed', 'pending_approval')
     returning id`,
    [tenantId, proposalKey, now],
  );
  return result.rows;
}

export async function supersedeWebsiteAiApproval(
  db: DbClient,
  tenantId: string,
  proposalId: string,
) {
  await db.query(
    `update approvals set status = 'superseded'
     where tenant_id = $1 and target_type = 'website_ai_proposal'
       and target_id = $2 and status = 'pending'`,
    [tenantId, proposalId],
  );
}

export async function insertWebsiteAiProposal(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    websiteId: string;
    sectionId: string;
    proposalKey: string;
    fingerprint: string;
    proposalType: WebsiteAiProposalRow["proposal_type"];
    title: string;
    rationale: string;
    expectedGain: string;
    riskSummary: string;
    proposedTitle: string;
    proposedBody: string;
    originalContentHash: string;
    version: number;
    supersedesId?: string | null;
    generationVersion: string;
    actorId: string;
    now: string;
  },
) {
  await db.query(
    `insert into website_ai_proposals (
       id, tenant_id, website_id, section_id, proposal_key, fingerprint,
       proposal_type, title, rationale, expected_gain, risk_summary,
       proposed_title, proposed_body, original_content_hash, status, version,
       supersedes_id, generation_version, created_by, created_at, updated_at
     ) values (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
       'proposed', $15, $16, $17, $18, $19, $19
     )`,
    [
      input.id, input.tenantId, input.websiteId, input.sectionId,
      input.proposalKey, input.fingerprint, input.proposalType, input.title,
      input.rationale, input.expectedGain, input.riskSummary,
      input.proposedTitle, input.proposedBody, input.originalContentHash,
      input.version, input.supersedesId ?? null, input.generationVersion,
      input.actorId, input.now,
    ],
  );
}

export async function insertWebsiteAiEvidence(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    proposalId: string;
    evidence: WebsiteAiEvidenceCandidate;
    now: string;
  },
) {
  await db.query(
    `insert into website_ai_evidence (
       id, tenant_id, proposal_id, evidence_type, evidence_ref, label,
       observed_value, captured_at, created_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
    [
      input.id, input.tenantId, input.proposalId, input.evidence.type,
      input.evidence.ref, input.evidence.label, input.evidence.observedValue,
      input.now,
    ],
  );
}

export async function listWebsiteAiProposals(db: DbClient, tenantId: string) {
  const result = await db.query<WebsiteAiProposalRow>(
    `select * from website_ai_proposals
     where tenant_id = $1 and status <> 'superseded'
     order by updated_at desc, proposal_key asc limit 50`,
    [tenantId],
  );
  return result.rows;
}

export async function listWebsiteAiEvidence(db: DbClient, tenantId: string) {
  const result = await db.query<WebsiteAiEvidenceRow>(
    `select evidence.* from website_ai_evidence evidence
     join website_ai_proposals proposals
       on proposals.tenant_id = evidence.tenant_id
      and proposals.id = evidence.proposal_id
     where evidence.tenant_id = $1 and proposals.status <> 'superseded'
     order by evidence.proposal_id, evidence.id`,
    [tenantId],
  );
  return result.rows;
}

export async function submitWebsiteAiProposal(
  db: DbClient,
  tenantId: string,
  proposalId: string,
  now: string,
) {
  const result = await db.query<{ id: string }>(
    `update website_ai_proposals
     set status = 'pending_approval', updated_at = $3
     where tenant_id = $1 and id = $2 and status = 'proposed'
     returning id`,
    [tenantId, proposalId, now],
  );
  return result.rows[0] ?? null;
}

export async function insertWebsiteAiApproval(
  db: DbClient,
  input: { id: string; tenantId: string; proposalId: string; actorId: string; now: string },
) {
  await db.query(
    `insert into approvals (
       id, tenant_id, requested_by, policy, status, target_type,
       target_id, created_at
     ) values (
       $1, $2, $3, 'administrator_approval_required', 'pending',
       'website_ai_proposal', $4, $5
     )`,
    [input.id, input.tenantId, input.actorId, input.proposalId, input.now],
  );
}

export async function decideWebsiteAiProposalRecord(
  db: DbClient,
  input: {
    tenantId: string;
    proposalId: string;
    decision: "approved" | "rejected";
    reason: string;
    actorId: string;
    now: string;
  },
) {
  const result = await db.query<{ id: string }>(
    `update website_ai_proposals
     set status = $3, decided_by = $4, decision_reason = $5,
         decided_at = $6, updated_at = $6
     where tenant_id = $1 and id = $2 and status = 'pending_approval'
     returning id`,
    [
      input.tenantId, input.proposalId, input.decision, input.actorId,
      input.reason, input.now,
    ],
  );
  return result.rows[0] ?? null;
}

export async function decideWebsiteAiApproval(
  db: DbClient,
  tenantId: string,
  proposalId: string,
  decision: "approved" | "rejected",
) {
  await db.query(
    `update approvals set status = $3
     where tenant_id = $1 and target_type = 'website_ai_proposal'
       and target_id = $2 and status = 'pending'`,
    [tenantId, proposalId, decision],
  );
}

export async function insertWebsiteAiDecision(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    proposalId: string;
    decision: "approved" | "rejected";
    reason: string;
    actorId: string;
    now: string;
  },
) {
  await db.query(
    `insert into website_ai_decisions (
       id, tenant_id, proposal_id, decision, reason, decided_by, created_at
     ) values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      input.id, input.tenantId, input.proposalId, input.decision,
      input.reason, input.actorId, input.now,
    ],
  );
}

export async function findApprovedWebsiteAiProposal(
  db: DbClient,
  tenantId: string,
  proposalId: string,
) {
  const result = await db.query<WebsiteAiProposalRow>(
    `select * from website_ai_proposals
     where tenant_id = $1 and id = $2 and status = 'approved'`,
    [tenantId, proposalId],
  );
  return result.rows[0] ?? null;
}

export async function markWebsiteAiProposalStale(
  db: DbClient,
  tenantId: string,
  proposalId: string,
  now: string,
) {
  await db.query(
    `update website_ai_proposals
     set status = 'stale', decided_by = null, decision_reason = null,
         decided_at = null, updated_at = $3
     where tenant_id = $1 and id = $2 and status = 'approved'`,
    [tenantId, proposalId, now],
  );
  await db.query(
    `update approvals set status = 'stale'
     where tenant_id = $1 and target_type = 'website_ai_proposal'
       and target_id = $2 and status = 'approved'`,
    [tenantId, proposalId],
  );
}

export async function markWebsiteAiProposalApplied(
  db: DbClient,
  input: { tenantId: string; proposalId: string; actorId: string; now: string },
) {
  const result = await db.query<{ id: string }>(
    `update website_ai_proposals
     set status = 'applied', applied_by = $3, applied_at = $4, updated_at = $4
     where tenant_id = $1 and id = $2 and status = 'approved'
     returning id`,
    [input.tenantId, input.proposalId, input.actorId, input.now],
  );
  return result.rows[0] ?? null;
}
