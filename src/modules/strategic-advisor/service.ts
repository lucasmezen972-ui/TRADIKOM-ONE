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
  liftStrategicRuleMute,
  listActiveStrategicRuleMutes,
  listStrategicRecommendationEvidence,
  listStrategicRecommendations,
  supersedeProposedStrategicRecommendations,
  supersedeStrategicApproval,
} from "@/modules/strategic-advisor/repository";
import {
  buildStrategicRecommendationCandidates,
  strategicAdvisorGenerationVersion,
  strategicMuteEndsAt,
  strategicMuteStartedAfter,
  strategicRefusalMuteDays,
} from "@/modules/strategic-advisor/rules";
import {
  strategicRecommendationDecisionSchema,
  strategicRuleMuteSchema,
  type StrategicRecommendationDecisionInput,
  type StrategicRuleMuteInput,
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
  options: { now?: Date } = {},
) {
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [...advisorRoles]);
    const workspace = await getBusinessBrain(transaction, userId, tenantId);
    const candidates = buildStrategicRecommendationCandidates(workspace);
    const clock = options.now ?? new Date();
    const now = clock.toISOString();
    // Une règle refusée récemment est écartée avant toute autre vérification :
    // la déduplication par empreinte ne suffit pas, l'empreinte change dès
    // qu'une valeur observée bouge.
    const mutedRules = new Set(
      (
        await listActiveStrategicRuleMutes(
          transaction,
          tenantId,
          strategicMuteStartedAfter(clock),
        )
      ).map((mute) => mute.rule_key),
    );
    const createdIds: string[] = [];
    let mutedCount = 0;

    for (const candidate of candidates) {
      if (mutedRules.has(candidate.ruleKey)) {
        mutedCount += 1;
        continue;
      }
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
        mutedCount,
      },
    });

    return { createdIds, candidateCount: candidates.length, mutedCount };
  });
}

/**
 * Les règles actuellement en sourdine, avec le motif du refus qui les a mises
 * là. Le dirigeant doit pouvoir constater qu'un conseil ne revient pas parce
 * qu'il l'a écarté, et non parce que le produit ne le détecte plus.
 */
export async function getStrategicRuleMutes(
  db: DbClient,
  userId: string,
  tenantId: string,
  options: { now?: Date } = {},
) {
  await assertTenantAccess(db, userId, tenantId);
  const clock = options.now ?? new Date();
  const rows = await listActiveStrategicRuleMutes(
    db,
    tenantId,
    strategicMuteStartedAfter(clock),
  );

  return rows.map((row) => ({
    ruleKey: row.rule_key,
    recommendationId: row.recommendation_id,
    title: row.title,
    reason: row.decision_reason,
    decidedAt: row.decided_at,
    decidedByName: row.decided_by_name ?? undefined,
    muteEndsAt: strategicMuteEndsAt(row.decided_at),
    muteDays: strategicRefusalMuteDays,
  }));
}

/**
 * Réactive une règle avant la fin de la sourdine. La décision de refus reste
 * telle quelle dans l'historique : seule la levée est enregistrée, avec son
 * auteur et son horodatage.
 */
export async function liftStrategicRecommendationMute(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: StrategicRuleMuteInput,
  options: { now?: Date } = {},
) {
  const parsed = strategicRuleMuteSchema.parse(input);
  const clock = options.now ?? new Date();
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [...advisorRoles]);
    // La levée ne touche que les refus qui mettent réellement la règle en
    // sourdine : un refus déjà expiré ne rend pas l'opération « réussie ».
    const lifted = await liftStrategicRuleMute(transaction, {
      tenantId,
      ruleKey: parsed.ruleKey,
      actorId: userId,
      mutedSince: strategicMuteStartedAfter(clock),
      now: nowIso(),
    });
    if (lifted.length === 0) {
      throw new StrategicAdvisorError(
        "strategic_rule_mute_not_found",
        "Cette règle n'est pas en sourdine.",
      );
    }

    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "strategic_advisor.rule_mute_lifted",
      targetType: "strategic_rule",
      targetId: parsed.ruleKey,
      metadata: { ruleKey: parsed.ruleKey, liftedCount: lifted.length },
    });

    return { ruleKey: parsed.ruleKey, liftedCount: lifted.length };
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
