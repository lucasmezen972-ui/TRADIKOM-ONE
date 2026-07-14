import type { DbClient } from "@/lib/db";
import {
  competitorGenerationVersion,
  type CompetitorEvidenceCandidate,
  type CompetitorImpact,
  type CompetitorInsightCandidate,
} from "@/modules/competitor-intelligence/rules";
import type {
  CompetitorCategory,
  CompetitorDirection,
  CompetitorSourceType,
} from "@/modules/competitor-intelligence/schemas";

export type CompetitorProfileRow = {
  id: string;
  tenant_id: string;
  name: string;
  website_url: string | null;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
};

export type CompetitorObservationRow = {
  id: string;
  tenant_id: string;
  competitor_id: string;
  category: CompetitorCategory;
  direction: CompetitorDirection;
  source_type: CompetitorSourceType;
  source_url: string;
  title: string;
  summary: string;
  observed_value: string | null;
  content_hash: string;
  observed_at: string;
  created_at: string;
};

export type CompetitorInsightRow = {
  id: string;
  competitor_id: string;
  competitor_name: string;
  category: CompetitorCategory;
  latest_observation_id: string;
  observation_title: string;
  observation_summary: string;
  source_url: string;
  impact: CompetitorImpact;
  confidence: number;
  title: string;
  rationale: string;
  recommended_action: string;
  status: "proposed" | "pending_approval" | "approved" | "rejected" | "superseded";
  version: number;
  decision_reason: string | null;
  decided_at: string | null;
  created_at: string;
};

export type CompetitorInsightEvidenceRow = {
  id: string;
  insight_id: string;
  observation_id: string;
  label: string;
  observed_value: string;
};

export async function listCompetitorProfiles(db: DbClient, tenantId: string) {
  const result = await db.query<CompetitorProfileRow>(
    `select id, tenant_id, name, website_url, status, created_at, updated_at
     from competitor_profiles where tenant_id = $1
     order by status, lower(name) limit 100`,
    [tenantId],
  );
  return result.rows;
}

export async function findCompetitorProfileByName(
  db: DbClient,
  tenantId: string,
  name: string,
) {
  const result = await db.query<{ id: string }>(
    `select id from competitor_profiles
     where tenant_id = $1 and lower(name) = lower($2)`,
    [tenantId, name],
  );
  return result.rows[0] ?? null;
}

export async function findActiveCompetitorProfile(
  db: DbClient,
  tenantId: string,
  competitorId: string,
) {
  const result = await db.query<CompetitorProfileRow>(
    `select id, tenant_id, name, website_url, status, created_at, updated_at
     from competitor_profiles
     where tenant_id = $1 and id = $2 and status = 'active'`,
    [tenantId, competitorId],
  );
  return result.rows[0] ?? null;
}

export async function insertCompetitorProfile(db: DbClient, input: {
  id: string;
  tenantId: string;
  name: string;
  websiteUrl: string | null;
  actorId: string;
  now: string;
}) {
  await db.query(
    `insert into competitor_profiles (
       id, tenant_id, name, website_url, status, created_by, created_at, updated_at
     ) values ($1, $2, $3, $4, 'active', $5, $6, $6)`,
    [input.id, input.tenantId, input.name, input.websiteUrl, input.actorId, input.now],
  );
}

export async function listCompetitorObservations(db: DbClient, tenantId: string) {
  const result = await db.query<CompetitorObservationRow>(
    `select id, tenant_id, competitor_id, category, direction, source_type,
       source_url, title, summary, observed_value, content_hash,
       observed_at, created_at
     from competitor_observations where tenant_id = $1
     order by observed_at desc, created_at desc limit 300`,
    [tenantId],
  );
  return result.rows;
}

export async function findCompetitorObservationByHash(
  db: DbClient,
  tenantId: string,
  competitorId: string,
  contentHash: string,
) {
  const result = await db.query<{ id: string }>(
    `select id from competitor_observations
     where tenant_id = $1 and competitor_id = $2 and content_hash = $3`,
    [tenantId, competitorId, contentHash],
  );
  return result.rows[0] ?? null;
}

export async function insertCompetitorObservation(db: DbClient, input: {
  id: string;
  tenantId: string;
  competitorId: string;
  category: CompetitorCategory;
  direction: CompetitorDirection;
  sourceType: CompetitorSourceType;
  sourceUrl: string;
  title: string;
  summary: string;
  observedValue: string | null;
  contentHash: string;
  observedAt: string;
  actorId: string;
  now: string;
}) {
  await db.query(
    `insert into competitor_observations (
       id, tenant_id, competitor_id, category, direction, source_type,
       source_url, title, summary, observed_value, content_hash,
       observed_at, recorded_by, created_at
     ) values (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14
     )`,
    [
      input.id,
      input.tenantId,
      input.competitorId,
      input.category,
      input.direction,
      input.sourceType,
      input.sourceUrl,
      input.title,
      input.summary,
      input.observedValue,
      input.contentHash,
      input.observedAt,
      input.actorId,
      input.now,
    ],
  );
}

export async function listCompetitorInsights(db: DbClient, tenantId: string) {
  const result = await db.query<CompetitorInsightRow>(
    `select competitor_insights.id, competitor_insights.competitor_id,
       competitor_profiles.name as competitor_name, competitor_insights.category,
       competitor_insights.latest_observation_id,
       competitor_observations.title as observation_title,
       competitor_observations.summary as observation_summary,
       competitor_observations.source_url,
       competitor_insights.impact, competitor_insights.confidence,
       competitor_insights.title, competitor_insights.rationale,
       competitor_insights.recommended_action, competitor_insights.status,
       competitor_insights.version, competitor_insights.decision_reason,
       competitor_insights.decided_at, competitor_insights.created_at
     from competitor_insights
     join competitor_profiles
       on competitor_profiles.tenant_id = competitor_insights.tenant_id
       and competitor_profiles.id = competitor_insights.competitor_id
     join competitor_observations
       on competitor_observations.tenant_id = competitor_insights.tenant_id
       and competitor_observations.id = competitor_insights.latest_observation_id
     where competitor_insights.tenant_id = $1
       and competitor_insights.status <> 'superseded'
     order by competitor_insights.updated_at desc limit 100`,
    [tenantId],
  );
  return result.rows;
}

export async function listCompetitorInsightEvidence(db: DbClient, tenantId: string) {
  const result = await db.query<CompetitorInsightEvidenceRow>(
    `select competitor_insight_evidence.id,
       competitor_insight_evidence.insight_id,
       competitor_insight_evidence.observation_id,
       competitor_insight_evidence.label,
       competitor_insight_evidence.observed_value
     from competitor_insight_evidence
     join competitor_insights
       on competitor_insights.tenant_id = competitor_insight_evidence.tenant_id
       and competitor_insights.id = competitor_insight_evidence.insight_id
     where competitor_insight_evidence.tenant_id = $1
       and competitor_insights.status <> 'superseded'
     order by competitor_insight_evidence.captured_at desc limit 300`,
    [tenantId],
  );
  return result.rows;
}

export async function findCompetitorInsightByFingerprint(
  db: DbClient,
  tenantId: string,
  competitorId: string,
  category: CompetitorCategory,
  fingerprint: string,
) {
  const result = await db.query<{ id: string }>(
    `select id from competitor_insights
     where tenant_id = $1 and competitor_id = $2 and category = $3
       and fingerprint = $4`,
    [tenantId, competitorId, category, fingerprint],
  );
  return result.rows[0] ?? null;
}

export async function getNextCompetitorInsightVersion(
  db: DbClient,
  tenantId: string,
  competitorId: string,
  category: CompetitorCategory,
) {
  const result = await db.query<{ version: number | string }>(
    `select coalesce(max(version), 0) + 1 as version from competitor_insights
     where tenant_id = $1 and competitor_id = $2 and category = $3`,
    [tenantId, competitorId, category],
  );
  return Number(result.rows[0]?.version ?? 1);
}

export async function supersedeOpenCompetitorInsights(
  db: DbClient,
  tenantId: string,
  competitorId: string,
  category: CompetitorCategory,
  now: string,
) {
  const result = await db.query<{ id: string }>(
    `update competitor_insights set status = 'superseded', updated_at = $4
     where tenant_id = $1 and competitor_id = $2 and category = $3
       and status in ('proposed', 'pending_approval') returning id`,
    [tenantId, competitorId, category, now],
  );
  return result.rows;
}

export async function supersedeCompetitorInsightApproval(
  db: DbClient,
  tenantId: string,
  insightId: string,
) {
  await db.query(
    `update approvals set status = 'superseded'
     where tenant_id = $1 and target_type = 'competitor_insight'
       and target_id = $2 and status = 'pending'`,
    [tenantId, insightId],
  );
}

export async function insertCompetitorInsight(db: DbClient, input: {
  id: string;
  tenantId: string;
  candidate: CompetitorInsightCandidate;
  version: number;
  supersedesId?: string;
  actorId: string;
  now: string;
}) {
  await db.query(
    `insert into competitor_insights (
       id, tenant_id, competitor_id, category, latest_observation_id,
       previous_observation_id, fingerprint, impact, confidence, title,
       rationale, recommended_action, status, version, supersedes_id,
       generation_version, generated_by, created_at, updated_at
     ) values (
       $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
       'proposed', $13, $14, $15, $16, $17, $17
     )`,
    [
      input.id,
      input.tenantId,
      input.candidate.competitorId,
      input.candidate.category,
      input.candidate.latestObservationId,
      input.candidate.previousObservationId ?? null,
      input.candidate.fingerprint,
      input.candidate.impact,
      input.candidate.confidence,
      input.candidate.title,
      input.candidate.rationale,
      input.candidate.recommendedAction,
      input.version,
      input.supersedesId ?? null,
      competitorGenerationVersion,
      input.actorId,
      input.now,
    ],
  );
}

export async function insertCompetitorInsightEvidence(db: DbClient, input: {
  id: string;
  tenantId: string;
  insightId: string;
  evidence: CompetitorEvidenceCandidate;
  now: string;
}) {
  await db.query(
    `insert into competitor_insight_evidence (
       id, tenant_id, insight_id, observation_id, label, observed_value,
       captured_at, created_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $7)`,
    [
      input.id,
      input.tenantId,
      input.insightId,
      input.evidence.observationId,
      input.evidence.label,
      input.evidence.observedValue,
      input.now,
    ],
  );
}

export async function submitCompetitorInsight(
  db: DbClient,
  tenantId: string,
  insightId: string,
  now: string,
) {
  const result = await db.query<{ id: string }>(
    `update competitor_insights set status = 'pending_approval', updated_at = $3
     where tenant_id = $1 and id = $2 and status = 'proposed' returning id`,
    [tenantId, insightId, now],
  );
  return result.rows[0] ?? null;
}

export async function insertCompetitorInsightApproval(db: DbClient, input: {
  id: string;
  tenantId: string;
  insightId: string;
  actorId: string;
  now: string;
}) {
  await db.query(
    `insert into approvals (
       id, tenant_id, requested_by, policy, status, target_type,
       target_id, created_at
     ) values (
       $1, $2, $3, 'administrator_approval_required', 'pending',
       'competitor_insight', $4, $5
     )`,
    [input.id, input.tenantId, input.actorId, input.insightId, input.now],
  );
}

export async function decideCompetitorInsightRecord(db: DbClient, input: {
  tenantId: string;
  insightId: string;
  decision: "approved" | "rejected";
  reason: string;
  actorId: string;
  now: string;
}) {
  const result = await db.query<{ id: string }>(
    `update competitor_insights
     set status = $3, decided_by = $4, decision_reason = $5,
       decided_at = $6, updated_at = $6
     where tenant_id = $1 and id = $2 and status = 'pending_approval'
     returning id`,
    [input.tenantId, input.insightId, input.decision, input.actorId, input.reason, input.now],
  );
  return result.rows[0] ?? null;
}

export async function decideCompetitorInsightApproval(
  db: DbClient,
  tenantId: string,
  insightId: string,
  decision: "approved" | "rejected",
) {
  await db.query(
    `update approvals set status = $3
     where tenant_id = $1 and target_type = 'competitor_insight'
       and target_id = $2 and status = 'pending'`,
    [tenantId, insightId, decision],
  );
}

export async function insertCompetitorInsightDecision(db: DbClient, input: {
  id: string;
  tenantId: string;
  insightId: string;
  decision: "approved" | "rejected";
  reason: string;
  actorId: string;
  now: string;
}) {
  await db.query(
    `insert into competitor_insight_decisions (
       id, tenant_id, insight_id, decision, reason, decided_by, created_at
     ) values ($1, $2, $3, $4, $5, $6, $7)`,
    [
      input.id,
      input.tenantId,
      input.insightId,
      input.decision,
      input.reason,
      input.actorId,
      input.now,
    ],
  );
}
