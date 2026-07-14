import type { DbClient } from "@/lib/db";
import type { ReputationEvidenceCandidate, ReputationRiskLevel, ReputationSentiment } from "@/modules/reputation-ai/rules";
import type { ReputationSource } from "@/modules/reputation-ai/schemas";

export type ReputationReviewRow = {
  id: string;
  tenant_id: string;
  source: ReputationSource;
  external_ref: string | null;
  reviewer_alias: string | null;
  rating: number | null;
  review_text: string;
  content_hash: string;
  occurred_at: string;
  imported_by: string;
  created_at: string;
};

export type ReputationProposalRow = {
  id: string;
  tenant_id: string;
  review_id: string;
  fingerprint: string;
  sentiment: ReputationSentiment;
  confidence: number;
  risk_level: ReputationRiskLevel;
  authenticity_status: "not_assessed";
  rationale: string;
  response_draft: string;
  improvement_plan: string;
  status: "proposed" | "pending_approval" | "approved" | "rejected" | "superseded";
  version: number;
  supersedes_id: string | null;
  generation_version: string;
  generated_by: string;
  decided_by: string | null;
  decision_reason: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ReputationEvidenceRow = {
  id: string;
  proposal_id: string;
  evidence_type: ReputationEvidenceCandidate["type"];
  evidence_ref: string;
  label: string;
  observed_value: string;
};

export async function listReputationReviews(db: DbClient, tenantId: string) {
  const result = await db.query<ReputationReviewRow>(
    "select * from reputation_reviews where tenant_id = $1 order by occurred_at desc limit 100",
    [tenantId],
  );
  return result.rows;
}

export async function listReputationProposals(db: DbClient, tenantId: string) {
  const result = await db.query<ReputationProposalRow>(
    `select * from reputation_response_proposals
     where tenant_id = $1 and status <> 'superseded'
     order by updated_at desc limit 100`,
    [tenantId],
  );
  return result.rows;
}

export async function listReputationEvidence(db: DbClient, tenantId: string) {
  const result = await db.query<ReputationEvidenceRow>(
    `select reputation_proposal_evidence.id,
       reputation_proposal_evidence.proposal_id,
       reputation_proposal_evidence.evidence_type,
       reputation_proposal_evidence.evidence_ref,
       reputation_proposal_evidence.label,
       reputation_proposal_evidence.observed_value
     from reputation_proposal_evidence
     join reputation_response_proposals
       on reputation_response_proposals.tenant_id = reputation_proposal_evidence.tenant_id
       and reputation_response_proposals.id = reputation_proposal_evidence.proposal_id
     where reputation_proposal_evidence.tenant_id = $1
       and reputation_response_proposals.status <> 'superseded'
     order by reputation_proposal_evidence.captured_at desc limit 300`,
    [tenantId],
  );
  return result.rows;
}

export async function findReputationReviewByHash(db: DbClient, tenantId: string, contentHash: string) {
  const result = await db.query<{ id: string }>(
    "select id from reputation_reviews where tenant_id = $1 and content_hash = $2",
    [tenantId, contentHash],
  );
  return result.rows[0] ?? null;
}

export async function insertReputationReview(db: DbClient, input: {
  id: string; tenantId: string; source: ReputationSource; externalRef: string | null;
  reviewerAlias: string | null; rating: number | null; reviewText: string;
  contentHash: string; occurredAt: string; actorId: string; now: string;
}) {
  await db.query(
    `insert into reputation_reviews (
       id, tenant_id, source, external_ref, reviewer_alias, rating, review_text,
       content_hash, occurred_at, imported_by, created_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [input.id, input.tenantId, input.source, input.externalRef, input.reviewerAlias,
      input.rating, input.reviewText, input.contentHash, input.occurredAt,
      input.actorId, input.now],
  );
}

export async function findReputationProposalByFingerprint(db: DbClient, tenantId: string, reviewId: string, fingerprint: string) {
  const result = await db.query<{ id: string }>(
    `select id from reputation_response_proposals
     where tenant_id = $1 and review_id = $2 and fingerprint = $3`,
    [tenantId, reviewId, fingerprint],
  );
  return result.rows[0] ?? null;
}

export async function getNextReputationProposalVersion(db: DbClient, tenantId: string, reviewId: string) {
  const result = await db.query<{ version: number | string }>(
    `select coalesce(max(version), 0) + 1 as version
     from reputation_response_proposals where tenant_id = $1 and review_id = $2`,
    [tenantId, reviewId],
  );
  return Number(result.rows[0]?.version ?? 1);
}

export async function supersedeOpenReputationProposals(db: DbClient, tenantId: string, reviewId: string, now: string) {
  const result = await db.query<{ id: string }>(
    `update reputation_response_proposals set status = 'superseded', updated_at = $3
     where tenant_id = $1 and review_id = $2 and status in ('proposed', 'pending_approval')
     returning id`,
    [tenantId, reviewId, now],
  );
  return result.rows;
}

export async function supersedeReputationApproval(db: DbClient, tenantId: string, proposalId: string) {
  await db.query(
    `update approvals set status = 'superseded'
     where tenant_id = $1 and target_type = 'reputation_response'
       and target_id = $2 and status = 'pending'`,
    [tenantId, proposalId],
  );
}

export async function insertReputationProposal(db: DbClient, input: {
  id: string; tenantId: string; reviewId: string; fingerprint: string;
  sentiment: ReputationSentiment; confidence: number; riskLevel: ReputationRiskLevel;
  rationale: string; responseDraft: string; improvementPlan: string; version: number;
  supersedesId?: string; generationVersion: string; actorId: string; now: string;
}) {
  await db.query(
    `insert into reputation_response_proposals (
       id, tenant_id, review_id, fingerprint, sentiment, confidence, risk_level,
       authenticity_status, rationale, response_draft, improvement_plan, status,
       version, supersedes_id, generation_version, generated_by, created_at, updated_at
     ) values (
       $1, $2, $3, $4, $5, $6, $7, 'not_assessed', $8, $9, $10, 'proposed',
       $11, $12, $13, $14, $15, $15
     )`,
    [input.id, input.tenantId, input.reviewId, input.fingerprint, input.sentiment,
      input.confidence, input.riskLevel, input.rationale, input.responseDraft,
      input.improvementPlan, input.version, input.supersedesId ?? null,
      input.generationVersion, input.actorId, input.now],
  );
}

export async function insertReputationEvidence(db: DbClient, input: {
  id: string; tenantId: string; proposalId: string;
  evidence: ReputationEvidenceCandidate; now: string;
}) {
  await db.query(
    `insert into reputation_proposal_evidence (
       id, tenant_id, proposal_id, evidence_type, evidence_ref, label,
       observed_value, captured_at, created_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
    [input.id, input.tenantId, input.proposalId, input.evidence.type,
      input.evidence.ref, input.evidence.label, input.evidence.observedValue, input.now],
  );
}

export async function submitReputationProposal(db: DbClient, tenantId: string, proposalId: string, now: string) {
  const result = await db.query<{ id: string }>(
    `update reputation_response_proposals set status = 'pending_approval', updated_at = $3
     where tenant_id = $1 and id = $2 and status = 'proposed' returning id`,
    [tenantId, proposalId, now],
  );
  return result.rows[0] ?? null;
}

export async function insertReputationApproval(db: DbClient, input: {
  id: string; tenantId: string; proposalId: string; actorId: string; now: string;
}) {
  await db.query(
    `insert into approvals (
       id, tenant_id, target_type, target_id, status, requested_by, policy, created_at
     ) values (
       $1, $2, 'reputation_response', $3, 'pending', $4,
       'administrator_approval_required', $5
     )`,
    [input.id, input.tenantId, input.proposalId, input.actorId, input.now],
  );
}

export async function decideReputationProposalRecord(db: DbClient, input: {
  tenantId: string; proposalId: string; decision: "approved" | "rejected";
  reason: string; actorId: string; now: string;
}) {
  const result = await db.query<{ id: string }>(
    `update reputation_response_proposals
     set status = $3, decided_by = $4, decision_reason = $5, decided_at = $6, updated_at = $6
     where tenant_id = $1 and id = $2 and status = 'pending_approval' returning id`,
    [input.tenantId, input.proposalId, input.decision, input.actorId, input.reason, input.now],
  );
  return result.rows[0] ?? null;
}

export async function decideReputationApproval(db: DbClient, tenantId: string, proposalId: string, decision: "approved" | "rejected") {
  await db.query(
    `update approvals set status = $3
     where tenant_id = $1 and target_type = 'reputation_response'
       and target_id = $2 and status = 'pending'`,
    [tenantId, proposalId, decision],
  );
}

export async function insertReputationDecision(db: DbClient, input: {
  id: string; tenantId: string; proposalId: string; decision: "approved" | "rejected";
  reason: string; actorId: string; now: string;
}) {
  await db.query(
    `insert into reputation_proposal_decisions (
       id, tenant_id, proposal_id, decision, reason, decided_by, created_at
     ) values ($1, $2, $3, $4, $5, $6, $7)`,
    [input.id, input.tenantId, input.proposalId, input.decision,
      input.reason, input.actorId, input.now],
  );
}
