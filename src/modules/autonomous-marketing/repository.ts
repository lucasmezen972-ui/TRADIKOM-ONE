import type { DbClient } from "@/lib/db";
import type { MarketingEvidenceCandidate } from "@/modules/autonomous-marketing/rules";
import type { MarketingChannel } from "@/modules/autonomous-marketing/schemas";

export type MarketingProposalStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "rejected"
  | "superseded"
  | "archived";

export type MarketingProposalRow = {
  id: string;
  tenant_id: string;
  campaign_key: string;
  fingerprint: string;
  channel: MarketingChannel;
  title: string;
  subject: string;
  objective: string;
  audience: string;
  content: string;
  call_to_action: string;
  expected_outcome: string;
  risk_summary: string;
  budget_cents: number | null;
  starts_at: string | null;
  ends_at: string | null;
  status: MarketingProposalStatus;
  version: number;
  supersedes_id: string | null;
  source_strategy_recommendation_id: string | null;
  generation_version: string;
  created_by: string;
  decided_by: string | null;
  decision_reason: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
};

export type MarketingEvidenceRow = {
  id: string;
  tenant_id: string;
  proposal_id: string;
  evidence_type: MarketingEvidenceCandidate["type"];
  evidence_ref: string;
  label: string;
  observed_value: string;
  captured_at: string;
  created_at: string;
};

type MarketingProposalWrite = {
  id: string;
  tenantId: string;
  campaignKey: string;
  fingerprint: string;
  channel: MarketingChannel;
  title: string;
  subject: string;
  objective: string;
  audience: string;
  content: string;
  callToAction: string;
  expectedOutcome: string;
  riskSummary: string;
  budgetCents?: number | null;
  startsAt?: string | null;
  endsAt?: string | null;
  version: number;
  supersedesId?: string | null;
  sourceStrategyRecommendationId?: string | null;
  generationVersion: string;
  actorId: string;
  now: string;
};

export async function findMarketingProposalByFingerprint(
  db: DbClient,
  tenantId: string,
  campaignKey: string,
  fingerprint: string,
) {
  const result = await db.query<{ id: string }>(
    `select id from marketing_campaign_proposals
     where tenant_id = $1 and campaign_key = $2 and fingerprint = $3`,
    [tenantId, campaignKey, fingerprint],
  );
  return result.rows[0] ?? null;
}

export async function insertMarketingProposal(db: DbClient, input: MarketingProposalWrite) {
  await db.query(
    `insert into marketing_campaign_proposals (
       id, tenant_id, campaign_key, fingerprint, channel, title, subject,
       objective, audience, content, call_to_action, expected_outcome,
       risk_summary, budget_cents, starts_at, ends_at, status, version,
       supersedes_id, source_strategy_recommendation_id, generation_version,
       created_by, created_at, updated_at
     ) values (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
       $15, $16, 'draft', $17, $18, $19, $20, $21, $22, $22
     )`,
    [
      input.id, input.tenantId, input.campaignKey, input.fingerprint,
      input.channel, input.title, input.subject, input.objective, input.audience,
      input.content, input.callToAction, input.expectedOutcome, input.riskSummary,
      input.budgetCents ?? null, input.startsAt ?? null, input.endsAt ?? null,
      input.version, input.supersedesId ?? null,
      input.sourceStrategyRecommendationId ?? null, input.generationVersion,
      input.actorId, input.now,
    ],
  );
}

export async function insertMarketingEvidence(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    proposalId: string;
    evidence: MarketingEvidenceCandidate;
    now: string;
  },
) {
  await db.query(
    `insert into marketing_campaign_evidence (
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

export async function listMarketingProposals(db: DbClient, tenantId: string) {
  const result = await db.query<MarketingProposalRow>(
    `select * from marketing_campaign_proposals
     where tenant_id = $1 and status not in ('superseded', 'archived')
     order by updated_at desc, campaign_key asc
     limit 50`,
    [tenantId],
  );
  return result.rows;
}

export async function listMarketingEvidence(db: DbClient, tenantId: string) {
  const result = await db.query<MarketingEvidenceRow>(
    `select evidence.*
     from marketing_campaign_evidence evidence
     join marketing_campaign_proposals proposals
       on proposals.tenant_id = evidence.tenant_id
      and proposals.id = evidence.proposal_id
     where evidence.tenant_id = $1
       and proposals.status not in ('superseded', 'archived')
     order by evidence.captured_at desc, evidence.id asc`,
    [tenantId],
  );
  return result.rows;
}

export async function findMarketingProposal(
  db: DbClient,
  tenantId: string,
  proposalId: string,
) {
  const result = await db.query<MarketingProposalRow>(
    `select * from marketing_campaign_proposals
     where tenant_id = $1 and id = $2`,
    [tenantId, proposalId],
  );
  return result.rows[0] ?? null;
}

export async function listEvidenceForProposal(
  db: DbClient,
  tenantId: string,
  proposalId: string,
) {
  const result = await db.query<MarketingEvidenceRow>(
    `select * from marketing_campaign_evidence
     where tenant_id = $1 and proposal_id = $2
     order by captured_at asc, id asc`,
    [tenantId, proposalId],
  );
  return result.rows;
}

export async function submitMarketingProposal(
  db: DbClient,
  tenantId: string,
  proposalId: string,
  now: string,
) {
  const result = await db.query<{ id: string }>(
    `update marketing_campaign_proposals
     set status = 'pending_approval', updated_at = $3
     where tenant_id = $1 and id = $2 and status = 'draft'
     returning id`,
    [tenantId, proposalId, now],
  );
  return result.rows[0] ?? null;
}

export async function insertMarketingApproval(
  db: DbClient,
  input: { id: string; tenantId: string; actorId: string; proposalId: string; now: string },
) {
  await db.query(
    `insert into approvals (
       id, tenant_id, requested_by, policy, status, target_type,
       target_id, created_at
     ) values (
       $1, $2, $3, 'administrator_approval_required', 'pending',
       'marketing_campaign_proposal', $4, $5
     )`,
    [input.id, input.tenantId, input.actorId, input.proposalId, input.now],
  );
}

export async function decideMarketingProposalRecord(
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
    `update marketing_campaign_proposals
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

export async function decideMarketingApproval(
  db: DbClient,
  tenantId: string,
  proposalId: string,
  decision: "approved" | "rejected",
) {
  await db.query(
    `update approvals set status = $3
     where tenant_id = $1 and target_type = 'marketing_campaign_proposal'
       and target_id = $2 and status = 'pending'`,
    [tenantId, proposalId, decision],
  );
}

export async function insertMarketingDecision(
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
    `insert into marketing_campaign_decisions (
       id, tenant_id, proposal_id, decision, reason, decided_by, created_at
     ) values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      input.id, input.tenantId, input.proposalId, input.decision,
      input.reason, input.actorId, input.now,
    ],
  );
}

export async function supersedeMarketingProposal(
  db: DbClient,
  tenantId: string,
  proposalId: string,
  now: string,
) {
  const result = await db.query<{ id: string }>(
    `update marketing_campaign_proposals
     set status = 'superseded', decided_by = null, decision_reason = null,
         decided_at = null, updated_at = $3
     where tenant_id = $1 and id = $2
       and status in ('draft', 'pending_approval', 'approved', 'rejected')
     returning id`,
    [tenantId, proposalId, now],
  );
  return result.rows[0] ?? null;
}

export async function supersedeMarketingApproval(
  db: DbClient,
  tenantId: string,
  proposalId: string,
) {
  await db.query(
    `update approvals set status = 'superseded'
     where tenant_id = $1 and target_type = 'marketing_campaign_proposal'
       and target_id = $2 and status = 'pending'`,
    [tenantId, proposalId],
  );
}
