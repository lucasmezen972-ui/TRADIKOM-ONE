import type { DbClient } from "@/lib/db";
import type { ApprovalCenterDecision, ApprovalCenterItem } from "@/lib/types";

type PendingRow = {
  approval_id: string;
  target_id: string;
  requested_at: string;
  title: string;
  rationale: string | null;
  expected_gain: string | null;
  risk_summary: string | null;
  confidence: number | string | null;
};

/**
 * Les propositions en attente sont lues type par type : chaque module borné
 * possède son propre contenu, son propre vocabulaire de statut et sa propre
 * page de décision. La jointure part toujours de `approvals`, seule source
 * autoritaire de ce qui reste réellement à décider.
 */
export async function listPendingStrategicApprovals(
  db: DbClient,
  tenantId: string,
  limit: number,
) {
  const result = await db.query<PendingRow>(
    `select approvals.id as approval_id, recommendations.id as target_id,
       approvals.created_at as requested_at, recommendations.title,
       recommendations.rationale, recommendations.expected_gain,
       recommendations.risk_summary, recommendations.confidence
     from approvals
     join strategic_recommendations as recommendations
       on recommendations.id = approvals.target_id
       and recommendations.tenant_id = approvals.tenant_id
     where approvals.tenant_id = $1 and approvals.status = 'pending'
       and approvals.target_type = 'strategic_recommendation'
     order by approvals.created_at asc
     limit $2`,
    [tenantId, limit],
  );
  return result.rows.map((row) => mapPending(row, "strategic"));
}

export async function listPendingMarketingApprovals(
  db: DbClient,
  tenantId: string,
  limit: number,
) {
  const result = await db.query<PendingRow>(
    `select approvals.id as approval_id, proposals.id as target_id,
       approvals.created_at as requested_at, proposals.title,
       proposals.objective as rationale,
       proposals.expected_outcome as expected_gain,
       proposals.risk_summary, null as confidence
     from approvals
     join marketing_campaign_proposals as proposals
       on proposals.id = approvals.target_id
       and proposals.tenant_id = approvals.tenant_id
     where approvals.tenant_id = $1 and approvals.status = 'pending'
       and approvals.target_type = 'marketing_campaign_proposal'
     order by approvals.created_at asc
     limit $2`,
    [tenantId, limit],
  );
  return result.rows.map((row) => mapPending(row, "marketing"));
}

export async function listPendingWebsiteAiApprovals(
  db: DbClient,
  tenantId: string,
  limit: number,
) {
  const result = await db.query<PendingRow>(
    `select approvals.id as approval_id, proposals.id as target_id,
       approvals.created_at as requested_at, proposals.title,
       proposals.rationale, proposals.expected_gain, proposals.risk_summary,
       null as confidence
     from approvals
     join website_ai_proposals as proposals
       on proposals.id = approvals.target_id
       and proposals.tenant_id = approvals.tenant_id
     where approvals.tenant_id = $1 and approvals.status = 'pending'
       and approvals.target_type = 'website_ai_proposal'
     order by approvals.created_at asc
     limit $2`,
    [tenantId, limit],
  );
  return result.rows.map((row) => mapPending(row, "website_ai"));
}

export async function listPendingReputationApprovals(
  db: DbClient,
  tenantId: string,
  limit: number,
) {
  const result = await db.query<PendingRow>(
    `select approvals.id as approval_id, proposals.id as target_id,
       approvals.created_at as requested_at,
       'Réponse à un avis client' as title,
       proposals.rationale, proposals.response_draft as expected_gain,
       proposals.risk_level as risk_summary, proposals.confidence
     from approvals
     join reputation_response_proposals as proposals
       on proposals.id = approvals.target_id
       and proposals.tenant_id = approvals.tenant_id
     where approvals.tenant_id = $1 and approvals.status = 'pending'
       and approvals.target_type = 'reputation_response'
     order by approvals.created_at asc
     limit $2`,
    [tenantId, limit],
  );
  return result.rows.map((row) => mapPending(row, "reputation"));
}

export async function listPendingCompetitorApprovals(
  db: DbClient,
  tenantId: string,
  limit: number,
) {
  const result = await db.query<PendingRow>(
    `select approvals.id as approval_id, insights.id as target_id,
       approvals.created_at as requested_at, insights.title,
       insights.rationale, insights.recommended_action as expected_gain,
       insights.impact as risk_summary, insights.confidence
     from approvals
     join competitor_insights as insights
       on insights.id = approvals.target_id
       and insights.tenant_id = approvals.tenant_id
     where approvals.tenant_id = $1 and approvals.status = 'pending'
       and approvals.target_type = 'competitor_insight'
     order by approvals.created_at asc
     limit $2`,
    [tenantId, limit],
  );
  return result.rows.map((row) => mapPending(row, "competitor"));
}

type DecisionRow = {
  id: string;
  decision: "approved" | "rejected";
  reason: string;
  created_at: string;
  title: string;
};

export async function listRecentApprovalDecisions(
  db: DbClient,
  tenantId: string,
  limit: number,
) {
  const result = await db.query<DecisionRow & { kind: string }>(
    `select id, decision, reason, created_at, title, kind from (
       select decisions.id, decisions.decision, decisions.reason,
         decisions.created_at, recommendations.title, 'strategic' as kind
       from strategic_recommendation_decisions as decisions
       join strategic_recommendations as recommendations
         on recommendations.id = decisions.recommendation_id
         and recommendations.tenant_id = decisions.tenant_id
       where decisions.tenant_id = $1
       union all
       select decisions.id, decisions.decision, decisions.reason,
         decisions.created_at, proposals.title, 'marketing' as kind
       from marketing_campaign_decisions as decisions
       join marketing_campaign_proposals as proposals
         on proposals.id = decisions.proposal_id
         and proposals.tenant_id = decisions.tenant_id
       where decisions.tenant_id = $1
       union all
       select decisions.id, decisions.decision, decisions.reason,
         decisions.created_at, proposals.title, 'website_ai' as kind
       from website_ai_decisions as decisions
       join website_ai_proposals as proposals
         on proposals.id = decisions.proposal_id
         and proposals.tenant_id = decisions.tenant_id
       where decisions.tenant_id = $1
       union all
       select decisions.id, decisions.decision, decisions.reason,
         decisions.created_at, 'Réponse à un avis client' as title,
         'reputation' as kind
       from reputation_proposal_decisions as decisions
       where decisions.tenant_id = $1
       union all
       select decisions.id, decisions.decision, decisions.reason,
         decisions.created_at, insights.title, 'competitor' as kind
       from competitor_insight_decisions as decisions
       join competitor_insights as insights
         on insights.id = decisions.insight_id
         and insights.tenant_id = decisions.tenant_id
       where decisions.tenant_id = $1
     ) as history
     order by created_at desc
     limit $2`,
    [tenantId, limit],
  );

  return result.rows.map((row) => ({
    id: row.id,
    kind: row.kind as ApprovalCenterItem["kind"],
    kindLabel: kindLabels[row.kind as ApprovalCenterItem["kind"]],
    title: row.title,
    decision: row.decision,
    reason: row.reason,
    decidedAt: row.created_at,
  })) satisfies ApprovalCenterDecision[];
}

const kindLabels: Record<ApprovalCenterItem["kind"], string> = {
  strategic: "Décision stratégique",
  marketing: "Campagne marketing",
  website_ai: "Contenu du site",
  reputation: "Réponse à un avis",
  competitor: "Veille concurrentielle",
};

const kindDetails: Record<
  ApprovalCenterItem["kind"],
  { detailHref: string; decisionField: string }
> = {
  strategic: {
    detailHref: "/conseiller-strategique",
    decisionField: "recommendationId",
  },
  marketing: { detailHref: "/marketing", decisionField: "proposalId" },
  website_ai: { detailHref: "/mon-site", decisionField: "proposalId" },
  reputation: { detailHref: "/reputation", decisionField: "proposalId" },
  competitor: {
    detailHref: "/veille-concurrentielle",
    decisionField: "insightId",
  },
};

function mapPending(
  row: PendingRow,
  kind: ApprovalCenterItem["kind"],
): ApprovalCenterItem {
  const details = kindDetails[kind];
  return {
    id: `${kind}:${row.target_id}`,
    kind,
    kindLabel: kindLabels[kind],
    targetId: row.target_id,
    title: row.title,
    rationale: row.rationale,
    expectedGain: row.expected_gain,
    riskSummary: row.risk_summary,
    confidence: toConfidence(row.confidence),
    requestedAt: row.requested_at,
    detailHref: details.detailHref,
    decisionField: details.decisionField,
  };
}

function toConfidence(value: number | string | null) {
  if (value === null || value === undefined) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
