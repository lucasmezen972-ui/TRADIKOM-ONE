import type { DbClient } from "@/lib/db";
import type {
  StrategicAdvisorRole,
  StrategicEffort,
} from "@/modules/strategic-advisor/schemas";
import type { StrategicEvidenceCandidate } from "@/modules/strategic-advisor/rules";

export type StrategicRecommendationRow = {
  id: string;
  tenant_id: string;
  rule_key: string;
  fingerprint: string;
  advisor_role: StrategicAdvisorRole;
  title: string;
  rationale: string;
  expected_gain: string;
  effort: StrategicEffort;
  roi_summary: string;
  risk_summary: string;
  confidence: number;
  action_label: string;
  action_href: string;
  status: "proposed" | "approved" | "rejected" | "superseded" | "expired";
  generation_version: string;
  created_by: string;
  decided_by: string | null;
  decision_reason: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
};

export type StrategicEvidenceRow = {
  id: string;
  tenant_id: string;
  recommendation_id: string;
  evidence_type: StrategicEvidenceCandidate["type"];
  evidence_ref: string;
  label: string;
  observed_value: string;
  captured_at: string;
  created_at: string;
};

export async function findStrategicRecommendationByFingerprint(
  db: DbClient,
  tenantId: string,
  ruleKey: string,
  fingerprint: string,
) {
  const result = await db.query<{ id: string }>(
    `select id from strategic_recommendations
     where tenant_id = $1 and rule_key = $2 and fingerprint = $3`,
    [tenantId, ruleKey, fingerprint],
  );
  return result.rows[0] ?? null;
}

export async function supersedeProposedStrategicRecommendations(
  db: DbClient,
  tenantId: string,
  ruleKey: string,
  now: string,
) {
  const result = await db.query<{ id: string }>(
    `update strategic_recommendations
     set status = 'superseded', updated_at = $3
     where tenant_id = $1 and rule_key = $2 and status = 'proposed'
     returning id`,
    [tenantId, ruleKey, now],
  );
  return result.rows;
}

export async function supersedeStrategicApproval(
  db: DbClient,
  tenantId: string,
  recommendationId: string,
) {
  await db.query(
    `update approvals
     set status = 'superseded'
     where tenant_id = $1 and target_type = 'strategic_recommendation'
       and target_id = $2 and status = 'pending'`,
    [tenantId, recommendationId],
  );
}

export async function insertStrategicRecommendation(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    ruleKey: string;
    fingerprint: string;
    role: StrategicAdvisorRole;
    title: string;
    rationale: string;
    expectedGain: string;
    effort: StrategicEffort;
    roiSummary: string;
    riskSummary: string;
    confidence: number;
    actionLabel: string;
    actionHref: string;
    generationVersion: string;
    actorId: string;
    now: string;
  },
) {
  await db.query(
    `insert into strategic_recommendations (
       id, tenant_id, rule_key, fingerprint, advisor_role, title, rationale,
       expected_gain, effort, roi_summary, risk_summary, confidence,
       action_label, action_href, status, generation_version, created_by,
       created_at, updated_at
     ) values (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
       'proposed', $15, $16, $17, $17
     )`,
    [
      input.id,
      input.tenantId,
      input.ruleKey,
      input.fingerprint,
      input.role,
      input.title,
      input.rationale,
      input.expectedGain,
      input.effort,
      input.roiSummary,
      input.riskSummary,
      input.confidence,
      input.actionLabel,
      input.actionHref,
      input.generationVersion,
      input.actorId,
      input.now,
    ],
  );
}

export async function insertStrategicRecommendationEvidence(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    recommendationId: string;
    evidence: StrategicEvidenceCandidate;
    now: string;
  },
) {
  await db.query(
    `insert into strategic_recommendation_evidence (
       id, tenant_id, recommendation_id, evidence_type, evidence_ref, label,
       observed_value, captured_at, created_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
    [
      input.id,
      input.tenantId,
      input.recommendationId,
      input.evidence.type,
      input.evidence.ref,
      input.evidence.label,
      input.evidence.observedValue,
      input.now,
    ],
  );
}

export async function insertStrategicApproval(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    actorId: string;
    recommendationId: string;
    now: string;
  },
) {
  await db.query(
    `insert into approvals (
       id, tenant_id, requested_by, policy, status, target_type,
       target_id, created_at
     ) values (
       $1, $2, $3, 'administrator_approval_required', 'pending',
       'strategic_recommendation', $4, $5
     )`,
    [
      input.id,
      input.tenantId,
      input.actorId,
      input.recommendationId,
      input.now,
    ],
  );
}

export async function listStrategicRecommendations(
  db: DbClient,
  tenantId: string,
) {
  const result = await db.query<StrategicRecommendationRow>(
    `select * from strategic_recommendations
     where tenant_id = $1 and status <> 'superseded'
     order by
       case status when 'proposed' then 0 when 'approved' then 1 else 2 end,
       created_at desc
     limit 50`,
    [tenantId],
  );
  return result.rows;
}

export async function listStrategicRecommendationEvidence(
  db: DbClient,
  tenantId: string,
) {
  const result = await db.query<StrategicEvidenceRow>(
    `select evidence.*
     from strategic_recommendation_evidence as evidence
     join strategic_recommendations as recommendations
       on recommendations.tenant_id = evidence.tenant_id
      and recommendations.id = evidence.recommendation_id
     where evidence.tenant_id = $1 and recommendations.status <> 'superseded'
     order by evidence.captured_at desc, evidence.id asc`,
    [tenantId],
  );
  return result.rows;
}

export async function findProposedStrategicRecommendation(
  db: DbClient,
  tenantId: string,
  recommendationId: string,
) {
  const result = await db.query<StrategicRecommendationRow>(
    `select * from strategic_recommendations
     where tenant_id = $1 and id = $2 and status = 'proposed'`,
    [tenantId, recommendationId],
  );
  return result.rows[0] ?? null;
}

export async function decideStrategicRecommendation(
  db: DbClient,
  input: {
    tenantId: string;
    recommendationId: string;
    decision: "approved" | "rejected";
    reason: string;
    actorId: string;
    now: string;
  },
) {
  const result = await db.query<{ id: string }>(
    `update strategic_recommendations
     set status = $3, decided_by = $4, decision_reason = $5,
         decided_at = $6, updated_at = $6
     where tenant_id = $1 and id = $2 and status = 'proposed'
     returning id`,
    [
      input.tenantId,
      input.recommendationId,
      input.decision,
      input.actorId,
      input.reason,
      input.now,
    ],
  );
  return result.rows[0] ?? null;
}

export async function decideStrategicApproval(
  db: DbClient,
  input: {
    tenantId: string;
    recommendationId: string;
    decision: "approved" | "rejected";
  },
) {
  await db.query(
    `update approvals
     set status = $3
     where tenant_id = $1 and target_type = 'strategic_recommendation'
       and target_id = $2 and status = 'pending'`,
    [input.tenantId, input.recommendationId, input.decision],
  );
}

export async function insertStrategicRecommendationDecision(
  db: DbClient,
  input: {
    id: string;
    tenantId: string;
    recommendationId: string;
    decision: "approved" | "rejected";
    reason: string;
    actorId: string;
    now: string;
  },
) {
  await db.query(
    `insert into strategic_recommendation_decisions (
       id, tenant_id, recommendation_id, decision, reason, decided_by,
       created_at
     ) values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      input.id,
      input.tenantId,
      input.recommendationId,
      input.decision,
      input.reason,
      input.actorId,
      input.now,
    ],
  );
}
