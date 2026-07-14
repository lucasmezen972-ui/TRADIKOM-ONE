import { withTenantDbTransaction } from "@/db/tenant-context";
import type { DbClient } from "@/lib/db";
import { id, nowIso } from "@/lib/security";
import { recordAuditLog } from "@/modules/audit";
import { getBusinessBrain } from "@/modules/business-brain";
import { StrategicAdvisorError } from "@/modules/strategic-advisor/errors";
import {
  decideStrategicApproval,
  decideStrategicRecommendation as decideStrategicRecommendationRecord,
  findProposedStrategicRecommendation,
  findStrategicRecommendationByFingerprint,
  insertStrategicApproval,
  insertStrategicRecommendation,
  insertStrategicRecommendationDecision,
  insertStrategicRecommendationEvidence,
  listStrategicRecommendationEvidence,
  listStrategicRecommendations,
  supersedeProposedStrategicRecommendations,
  supersedeStrategicApproval,
} from "@/modules/strategic-advisor/repository";
import {
  buildStrategicRecommendationCandidates,
  strategicAdvisorGenerationVersion,
} from "@/modules/strategic-advisor/rules";
import {
  strategicRecommendationDecisionSchema,
  type StrategicRecommendationDecisionInput,
} from "@/modules/strategic-advisor/schemas";
import { assertTenantAccess } from "@/modules/tenants";

const advisorRoles = ["owner", "administrator", "manager"] as const;

export async function getStrategicAdvisor(
  db: DbClient,
  userId: string,
  tenantId: string,
) {
  await assertTenantAccess(db, userId, tenantId);
  const [rows, evidenceRows] = await Promise.all([
    listStrategicRecommendations(db, tenantId),
    listStrategicRecommendationEvidence(db, tenantId),
  ]);
  const evidenceByRecommendation = new Map<
    string,
    Array<{
      id: string;
      type: (typeof evidenceRows)[number]["evidence_type"];
      ref: string;
      label: string;
      observedValue: string;
      capturedAt: string;
    }>
  >();
  for (const evidence of evidenceRows) {
    const current = evidenceByRecommendation.get(evidence.recommendation_id) ?? [];
    current.push({
      id: evidence.id,
      type: evidence.evidence_type,
      ref: evidence.evidence_ref,
      label: evidence.label,
      observedValue: evidence.observed_value,
      capturedAt: evidence.captured_at,
    });
    evidenceByRecommendation.set(evidence.recommendation_id, current);
  }

  return rows.map((row) => ({
    id: row.id,
    ruleKey: row.rule_key,
    role: row.advisor_role,
    title: row.title,
    rationale: row.rationale,
    expectedGain: row.expected_gain,
    effort: row.effort,
    roiSummary: row.roi_summary,
    riskSummary: row.risk_summary,
    confidence: row.confidence,
    actionLabel: row.action_label,
    actionHref: row.action_href,
    status: row.status,
    generationVersion: row.generation_version,
    decidedBy: row.decided_by ?? undefined,
    decisionReason: row.decision_reason ?? undefined,
    decidedAt: row.decided_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    evidence: evidenceByRecommendation.get(row.id) ?? [],
  }));
}

export async function generateStrategicRecommendations(
  db: DbClient,
  userId: string,
  tenantId: string,
) {
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [...advisorRoles]);
    const workspace = await getBusinessBrain(transaction, userId, tenantId);
    const candidates = buildStrategicRecommendationCandidates(workspace);
    const now = nowIso();
    const createdIds: string[] = [];

    for (const candidate of candidates) {
      const duplicate = await findStrategicRecommendationByFingerprint(
        transaction,
        tenantId,
        candidate.ruleKey,
        candidate.fingerprint,
      );
      if (duplicate) continue;

      const superseded = await supersedeProposedStrategicRecommendations(
        transaction,
        tenantId,
        candidate.ruleKey,
        now,
      );
      for (const recommendation of superseded) {
        await supersedeStrategicApproval(
          transaction,
          tenantId,
          recommendation.id,
        );
      }

      const recommendationId = id("strategic_recommendation");
      await insertStrategicRecommendation(transaction, {
        id: recommendationId,
        tenantId,
        ...candidate,
        generationVersion: strategicAdvisorGenerationVersion,
        actorId: userId,
        now,
      });
      for (const evidence of candidate.evidence) {
        await insertStrategicRecommendationEvidence(transaction, {
          id: id("strategic_evidence"),
          tenantId,
          recommendationId,
          evidence,
          now,
        });
      }
      await insertStrategicApproval(transaction, {
        id: id("approval"),
        tenantId,
        actorId: userId,
        recommendationId,
        now,
      });
      createdIds.push(recommendationId);
    }

    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "strategic_advisor.recommendations_generated",
      targetType: "tenant",
      targetId: tenantId,
      metadata: {
        generationVersion: strategicAdvisorGenerationVersion,
        candidateCount: candidates.length,
        createdCount: createdIds.length,
      },
    });

    return { createdIds, candidateCount: candidates.length };
  });
}

export async function decideStrategicRecommendation(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: StrategicRecommendationDecisionInput,
) {
  const parsed = strategicRecommendationDecisionSchema.parse(input);
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [...advisorRoles]);
    const recommendation = await findProposedStrategicRecommendation(
      transaction,
      tenantId,
      parsed.recommendationId,
    );
    if (!recommendation) {
      throw new StrategicAdvisorError(
        "strategic_recommendation_not_found",
        "Cette recommandation n'existe pas ou a déjà été décidée.",
      );
    }

    const now = nowIso();
    const decided = await decideStrategicRecommendationRecord(transaction, {
      tenantId,
      recommendationId: recommendation.id,
      decision: parsed.decision,
      reason: parsed.reason,
      actorId: userId,
      now,
    });
    if (!decided) {
      throw new StrategicAdvisorError(
        "strategic_recommendation_conflict",
        "Cette recommandation a déjà été décidée.",
      );
    }
    await decideStrategicApproval(transaction, {
      tenantId,
      recommendationId: recommendation.id,
      decision: parsed.decision,
    });
    await insertStrategicRecommendationDecision(transaction, {
      id: id("strategic_decision"),
      tenantId,
      recommendationId: recommendation.id,
      decision: parsed.decision,
      reason: parsed.reason,
      actorId: userId,
      now,
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: `strategic_advisor.recommendation_${parsed.decision}`,
      targetType: "strategic_recommendation",
      targetId: recommendation.id,
      metadata: {
        ruleKey: recommendation.rule_key,
        generationVersion: recommendation.generation_version,
        executionTriggered: false,
      },
    });
  });
}
