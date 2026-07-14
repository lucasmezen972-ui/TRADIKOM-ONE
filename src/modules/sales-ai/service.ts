import { withTenantDbTransaction } from "@/db/tenant-context";
import type { DbClient } from "@/lib/db";
import { id } from "@/lib/security";
import { recordAuditLog } from "@/modules/audit";
import { SalesAiError } from "@/modules/sales-ai/errors";
import {
  findCurrentSalesAiAssessmentByFingerprint,
  getNextSalesAiAssessmentVersion,
  insertSalesAiAssessment,
  insertSalesAiEvidence,
  listActiveSalesOpportunitySignals,
  listCurrentSalesAiAssessments,
  listCurrentSalesAiEvidence,
  supersedeCurrentSalesAiAssessment,
} from "@/modules/sales-ai/repository";
import {
  buildSalesAssessmentCandidate,
  salesAiGenerationVersion,
} from "@/modules/sales-ai/rules";
import { assertTenantAccess } from "@/modules/tenants";

const salesAiManageRoles = ["owner", "administrator", "manager"] as const;

export async function getSalesAiWorkspace(
  db: DbClient,
  userId: string,
  tenantId: string,
) {
  await assertTenantAccess(db, userId, tenantId);
  const [assessments, evidence] = await Promise.all([
    listCurrentSalesAiAssessments(db, tenantId),
    listCurrentSalesAiEvidence(db, tenantId),
  ]);
  const evidenceByAssessment = new Map<string, Array<{
    id: string;
    type: (typeof evidence)[number]["evidence_type"];
    ref: string;
    label: string;
    observedValue: string;
  }>>();
  for (const item of evidence) {
    const current = evidenceByAssessment.get(item.assessment_id) ?? [];
    current.push({
      id: item.id,
      type: item.evidence_type,
      ref: item.evidence_ref,
      label: item.label,
      observedValue: item.observed_value,
    });
    evidenceByAssessment.set(item.assessment_id, current);
  }
  return assessments.map((assessment) => ({
    id: assessment.id,
    opportunityId: assessment.opportunity_id,
    contactName: assessment.contact_name,
    stageName: assessment.stage_name,
    valueCents: Number(assessment.value_cents),
    nextFollowUpAt: assessment.next_follow_up_at ?? undefined,
    score: Number(assessment.score),
    closingEstimate: Number(assessment.closing_estimate),
    confidence: Number(assessment.confidence),
    priority: assessment.priority,
    title: assessment.title,
    rationale: assessment.rationale,
    recommendedAction: assessment.recommended_action,
    riskSummary: assessment.risk_summary,
    actionLabel: assessment.action_label,
    actionHref: assessment.action_href,
    version: Number(assessment.version),
    createdAt: assessment.created_at,
    evidence: evidenceByAssessment.get(assessment.id) ?? [],
  }));
}

export async function generateSalesAiAssessments(
  db: DbClient,
  userId: string,
  tenantId: string,
  options: { now?: Date } = {},
) {
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [
      ...salesAiManageRoles,
    ]);
    const nowDate = options.now ?? new Date();
    const now = nowDate.toISOString();
    const signals = await listActiveSalesOpportunitySignals(
      transaction,
      tenantId,
      now,
    );
    const current = await listCurrentSalesAiAssessments(transaction, tenantId);
    const activeIds = new Set(signals.map((signal) => signal.opportunityId));
    let supersededCount = 0;
    for (const assessment of current) {
      if (!activeIds.has(assessment.opportunity_id)) {
        const superseded = await supersedeCurrentSalesAiAssessment(
          transaction,
          tenantId,
          assessment.opportunity_id,
          now,
        );
        supersededCount += superseded.length;
      }
    }

    const createdIds: string[] = [];
    for (const signal of signals) {
      const candidate = buildSalesAssessmentCandidate(signal, nowDate);
      if (candidate.evidence.length === 0) {
        throw new SalesAiError(
          "sales_ai_evidence_required",
          "Une évaluation commerciale doit contenir des preuves.",
        );
      }
      const duplicate = await findCurrentSalesAiAssessmentByFingerprint(
        transaction,
        tenantId,
        signal.opportunityId,
        candidate.fingerprint,
      );
      if (duplicate) continue;
      const superseded = await supersedeCurrentSalesAiAssessment(
        transaction,
        tenantId,
        signal.opportunityId,
        now,
      );
      supersededCount += superseded.length;
      const assessmentId = id("sales_ai_assessment");
      await insertSalesAiAssessment(transaction, {
        id: assessmentId,
        tenantId,
        candidate,
        version: await getNextSalesAiAssessmentVersion(
          transaction,
          tenantId,
          signal.opportunityId,
        ),
        supersedesId: superseded[0]?.id,
        generationVersion: salesAiGenerationVersion,
        actorId: userId,
        now,
      });
      for (const evidence of candidate.evidence) {
        await insertSalesAiEvidence(transaction, {
          id: id("sales_ai_evidence"),
          tenantId,
          assessmentId,
          evidence,
          now,
        });
      }
      createdIds.push(assessmentId);
    }
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "sales_ai.assessments_generated",
      targetType: "tenant",
      targetId: tenantId,
      metadata: {
        candidateCount: signals.length,
        createdCount: createdIds.length,
        supersededCount,
        generationVersion: salesAiGenerationVersion,
        externalActionTriggered: false,
        messageGenerated: false,
        quotationGenerated: false,
        discountSuggested: false,
      },
    });
    return {
      createdIds,
      candidateCount: signals.length,
      supersededCount,
    };
  });
}
