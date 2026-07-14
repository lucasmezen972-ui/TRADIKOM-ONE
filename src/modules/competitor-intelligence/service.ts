import { withTenantDbTransaction } from "@/db/tenant-context";
import type { DbClient } from "@/lib/db";
import { hashToken, id, nowIso, toJson } from "@/lib/security";
import { recordAuditLog } from "@/modules/audit";
import { CompetitorIntelligenceError } from "@/modules/competitor-intelligence/errors";
import {
  decideCompetitorInsightApproval,
  decideCompetitorInsightRecord,
  findActiveCompetitorProfile,
  findCompetitorInsightByFingerprint,
  findCompetitorObservationByHash,
  findCompetitorProfileByName,
  getNextCompetitorInsightVersion,
  insertCompetitorInsight,
  insertCompetitorInsightApproval,
  insertCompetitorInsightDecision,
  insertCompetitorInsightEvidence,
  insertCompetitorObservation,
  insertCompetitorProfile,
  listCompetitorInsightEvidence,
  listCompetitorInsights,
  listCompetitorObservations,
  listCompetitorProfiles,
  submitCompetitorInsight,
  supersedeCompetitorInsightApproval,
  supersedeOpenCompetitorInsights,
} from "@/modules/competitor-intelligence/repository";
import {
  buildCompetitorInsightCandidate,
  competitorGenerationVersion,
} from "@/modules/competitor-intelligence/rules";
import {
  competitorInsightDecisionSchema,
  competitorInsightReferenceSchema,
  competitorObservationSchema,
  competitorProfileSchema,
  type CompetitorInsightDecisionInput,
  type CompetitorInsightReferenceInput,
  type CompetitorObservationInput,
  type CompetitorProfileInput,
} from "@/modules/competitor-intelligence/schemas";
import { assertTenantAccess } from "@/modules/tenants";

const competitorManageRoles = ["owner", "administrator", "manager"] as const;

export async function getCompetitorIntelligenceWorkspace(
  db: DbClient,
  userId: string,
  tenantId: string,
) {
  await assertTenantAccess(db, userId, tenantId);
  const [profiles, observations, insights, evidenceRows] = await Promise.all([
    listCompetitorProfiles(db, tenantId),
    listCompetitorObservations(db, tenantId),
    listCompetitorInsights(db, tenantId),
    listCompetitorInsightEvidence(db, tenantId),
  ]);
  const profileNames = new Map(profiles.map((profile) => [profile.id, profile.name]));
  const evidenceByInsight = new Map<string, Array<{
    id: string;
    observationId: string;
    label: string;
    observedValue: string;
  }>>();
  for (const evidence of evidenceRows) {
    const current = evidenceByInsight.get(evidence.insight_id) ?? [];
    current.push({
      id: evidence.id,
      observationId: evidence.observation_id,
      label: evidence.label,
      observedValue: evidence.observed_value,
    });
    evidenceByInsight.set(evidence.insight_id, current);
  }
  return {
    competitors: profiles.map((profile) => ({
      id: profile.id,
      name: profile.name,
      websiteUrl: profile.website_url ?? undefined,
      status: profile.status,
      createdAt: profile.created_at,
    })),
    observations: observations.map((observation) => ({
      id: observation.id,
      competitorId: observation.competitor_id,
      competitorName: profileNames.get(observation.competitor_id) ?? "Concurrent",
      category: observation.category,
      direction: observation.direction,
      sourceType: observation.source_type,
      sourceUrl: observation.source_url,
      title: observation.title,
      summary: observation.summary,
      observedValue: observation.observed_value ?? undefined,
      observedAt: observation.observed_at,
      createdAt: observation.created_at,
    })),
    insights: insights.map((insight) => ({
      id: insight.id,
      competitorId: insight.competitor_id,
      competitorName: insight.competitor_name,
      category: insight.category,
      latestObservationId: insight.latest_observation_id,
      observationTitle: insight.observation_title,
      observationSummary: insight.observation_summary,
      sourceUrl: insight.source_url,
      impact: insight.impact,
      confidence: Number(insight.confidence),
      title: insight.title,
      rationale: insight.rationale,
      recommendedAction: insight.recommended_action,
      status: insight.status,
      version: Number(insight.version),
      decisionReason: insight.decision_reason ?? undefined,
      decidedAt: insight.decided_at ?? undefined,
      createdAt: insight.created_at,
      evidence: evidenceByInsight.get(insight.id) ?? [],
    })),
  };
}

export async function createCompetitorProfile(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: CompetitorProfileInput,
) {
  const parsed = competitorProfileSchema.parse(input);
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [
      ...competitorManageRoles,
    ]);
    if (await findCompetitorProfileByName(transaction, tenantId, parsed.name)) {
      throw new CompetitorIntelligenceError(
        "competitor_duplicate",
        "Ce concurrent existe déjà.",
      );
    }
    const competitorId = id("competitor");
    const now = nowIso();
    await insertCompetitorProfile(transaction, {
      id: competitorId,
      tenantId,
      name: parsed.name,
      websiteUrl: parsed.websiteUrl ? canonicalPublicUrl(parsed.websiteUrl) : null,
      actorId: userId,
      now,
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "competitor.profile_created",
      targetType: "competitor",
      targetId: competitorId,
      metadata: {
        websiteReferenceProvided: Boolean(parsed.websiteUrl),
        externalFetchTriggered: false,
      },
    });
    return { competitorId };
  });
}

export async function createCompetitorObservation(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: CompetitorObservationInput,
) {
  const parsed = competitorObservationSchema.parse(input);
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [
      ...competitorManageRoles,
    ]);
    const competitor = await findActiveCompetitorProfile(
      transaction,
      tenantId,
      parsed.competitorId,
    );
    if (!competitor) {
      throw new CompetitorIntelligenceError(
        "competitor_not_found",
        "Ce concurrent n'est pas disponible.",
      );
    }
    const sourceUrl = canonicalPublicUrl(parsed.sourceUrl);
    const observedAt = new Date(parsed.observedAt).toISOString();
    const contentHash = hashToken(
      toJson({
        competitorId: parsed.competitorId,
        category: parsed.category,
        direction: parsed.direction,
        sourceType: parsed.sourceType,
        sourceUrl,
        title: parsed.title,
        summary: parsed.summary,
        observedValue: parsed.observedValue ?? null,
        observedAt,
      }),
    );
    if (
      await findCompetitorObservationByHash(
        transaction,
        tenantId,
        parsed.competitorId,
        contentHash,
      )
    ) {
      throw new CompetitorIntelligenceError(
        "competitor_observation_duplicate",
        "Cette observation a déjà été enregistrée.",
      );
    }
    const observationId = id("competitor_observation");
    const now = nowIso();
    await insertCompetitorObservation(transaction, {
      id: observationId,
      tenantId,
      competitorId: parsed.competitorId,
      category: parsed.category,
      direction: parsed.direction,
      sourceType: parsed.sourceType,
      sourceUrl,
      title: parsed.title,
      summary: parsed.summary,
      observedValue: parsed.observedValue ?? null,
      contentHash,
      observedAt,
      actorId: userId,
      now,
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "competitor.observation_recorded",
      targetType: "competitor_observation",
      targetId: observationId,
      metadata: {
        competitorId: parsed.competitorId,
        category: parsed.category,
        direction: parsed.direction,
        sourceType: parsed.sourceType,
        publicSourceConfirmed: true,
        protectedContentExcluded: true,
        externalFetchTriggered: false,
      },
    });
    return { observationId };
  });
}

export async function generateCompetitorInsights(
  db: DbClient,
  userId: string,
  tenantId: string,
) {
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [
      ...competitorManageRoles,
    ]);
    const [profiles, observations] = await Promise.all([
      listCompetitorProfiles(transaction, tenantId),
      listCompetitorObservations(transaction, tenantId),
    ]);
    const activeNames = new Map(
      profiles
        .filter((profile) => profile.status === "active")
        .map((profile) => [profile.id, profile.name]),
    );
    const grouped = new Map<string, typeof observations>();
    for (const observation of observations) {
      if (!activeNames.has(observation.competitor_id)) continue;
      const key = `${observation.competitor_id}:${observation.category}`;
      const current = grouped.get(key) ?? [];
      current.push(observation);
      grouped.set(key, current);
    }
    const now = nowIso();
    const createdIds: string[] = [];
    let supersededCount = 0;
    for (const group of grouped.values()) {
      const latest = group[0];
      if (!latest) continue;
      const candidate = buildCompetitorInsightCandidate({
        competitorName: activeNames.get(latest.competitor_id) ?? "Concurrent",
        latest,
        previous: group[1],
      });
      const duplicate = await findCompetitorInsightByFingerprint(
        transaction,
        tenantId,
        candidate.competitorId,
        candidate.category,
        candidate.fingerprint,
      );
      if (duplicate) continue;
      const superseded = await supersedeOpenCompetitorInsights(
        transaction,
        tenantId,
        candidate.competitorId,
        candidate.category,
        now,
      );
      for (const insight of superseded) {
        await supersedeCompetitorInsightApproval(transaction, tenantId, insight.id);
      }
      supersededCount += superseded.length;
      const insightId = id("competitor_insight");
      await insertCompetitorInsight(transaction, {
        id: insightId,
        tenantId,
        candidate,
        version: await getNextCompetitorInsightVersion(
          transaction,
          tenantId,
          candidate.competitorId,
          candidate.category,
        ),
        supersedesId: superseded[0]?.id,
        actorId: userId,
        now,
      });
      for (const evidence of candidate.evidence) {
        await insertCompetitorInsightEvidence(transaction, {
          id: id("competitor_evidence"),
          tenantId,
          insightId,
          evidence,
          now,
        });
      }
      createdIds.push(insightId);
    }
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "competitor.insights_generated",
      targetType: "tenant",
      targetId: tenantId,
      metadata: {
        observationGroupCount: grouped.size,
        createdCount: createdIds.length,
        supersededCount,
        generationVersion: competitorGenerationVersion,
        externalFetchTriggered: false,
        externalActionTriggered: false,
        scrapingTriggered: false,
      },
    });
    return { createdIds, observationGroupCount: grouped.size, supersededCount };
  });
}

export async function submitCompetitorInsightForApproval(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: CompetitorInsightReferenceInput,
) {
  const parsed = competitorInsightReferenceSchema.parse(input);
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [
      ...competitorManageRoles,
    ]);
    const now = nowIso();
    const submitted = await submitCompetitorInsight(
      transaction,
      tenantId,
      parsed.insightId,
      now,
    );
    if (!submitted) {
      throw new CompetitorIntelligenceError(
        "competitor_insight_not_proposed",
        "Cette analyse n'est plus disponible.",
      );
    }
    await insertCompetitorInsightApproval(transaction, {
      id: id("approval"),
      tenantId,
      insightId: parsed.insightId,
      actorId: userId,
      now,
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "competitor.insight_submitted",
      targetType: "competitor_insight",
      targetId: parsed.insightId,
      metadata: { externalActionTriggered: false },
    });
  });
}

export async function decideCompetitorInsight(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: CompetitorInsightDecisionInput,
) {
  const parsed = competitorInsightDecisionSchema.parse(input);
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [
      ...competitorManageRoles,
    ]);
    const now = nowIso();
    const decided = await decideCompetitorInsightRecord(transaction, {
      tenantId,
      insightId: parsed.insightId,
      decision: parsed.decision,
      reason: parsed.reason,
      actorId: userId,
      now,
    });
    if (!decided) {
      throw new CompetitorIntelligenceError(
        "competitor_insight_not_pending",
        "Cette analyse n'attend plus de décision.",
      );
    }
    await decideCompetitorInsightApproval(
      transaction,
      tenantId,
      parsed.insightId,
      parsed.decision,
    );
    await insertCompetitorInsightDecision(transaction, {
      id: id("competitor_decision"),
      tenantId,
      insightId: parsed.insightId,
      decision: parsed.decision,
      reason: parsed.reason,
      actorId: userId,
      now,
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: `competitor.insight_${parsed.decision}`,
      targetType: "competitor_insight",
      targetId: parsed.insightId,
      metadata: { externalActionTriggered: false },
    });
  });
}

function canonicalPublicUrl(value: string) {
  const url = new URL(value);
  url.username = "";
  url.password = "";
  url.search = "";
  url.hash = "";
  return url.toString();
}
