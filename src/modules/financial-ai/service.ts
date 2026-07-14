import { withTenantDbTransaction } from "@/db/tenant-context";
import type { DbClient } from "@/lib/db";
import { id, nowIso } from "@/lib/security";
import { recordAuditLog } from "@/modules/audit";
import { FinancialAiError } from "@/modules/financial-ai/errors";
import {
  findFinancialAssessmentByFingerprint,
  findLatestCurrentFinancialSnapshot,
  getFinancialPipelineSignal,
  getNextFinancialAssessmentVersion,
  getNextFinancialSnapshotVersion,
  insertFinancialAlert,
  insertFinancialAssessment,
  insertFinancialEvidence,
  insertFinancialSnapshot,
  listCurrentFinancialAlerts,
  listCurrentFinancialAssessments,
  listCurrentFinancialEvidence,
  listCurrentFinancialSnapshots,
  listFinancialBrainEvidence,
  supersedeCurrentFinancialAssessments,
  supersedeCurrentFinancialSnapshots,
} from "@/modules/financial-ai/repository";
import {
  buildFinancialAssessmentCandidate,
  financialAiGenerationVersion,
} from "@/modules/financial-ai/rules";
import {
  financialInputSnapshotSchema,
  type FinancialInputSnapshotInput,
} from "@/modules/financial-ai/schemas";
import { assertTenantAccess } from "@/modules/tenants";

const financialManageRoles = ["owner", "administrator", "manager"] as const;

export async function getFinancialAiWorkspace(
  db: DbClient,
  userId: string,
  tenantId: string,
) {
  await assertTenantAccess(db, userId, tenantId);
  const [snapshots, assessments, evidenceRows, alertRows] = await Promise.all([
    listCurrentFinancialSnapshots(db, tenantId),
    listCurrentFinancialAssessments(db, tenantId),
    listCurrentFinancialEvidence(db, tenantId),
    listCurrentFinancialAlerts(db, tenantId),
  ]);
  const evidenceByAssessment = new Map<string, Array<{
    id: string;
    type: (typeof evidenceRows)[number]["evidence_type"];
    sourceRef: string;
    label: string;
    observedValue: string;
  }>>();
  for (const evidence of evidenceRows) {
    const current = evidenceByAssessment.get(evidence.assessment_id) ?? [];
    current.push({
      id: evidence.id,
      type: evidence.evidence_type,
      sourceRef: evidence.source_ref,
      label: evidence.label,
      observedValue: evidence.observed_value,
    });
    evidenceByAssessment.set(evidence.assessment_id, current);
  }
  const alertsByAssessment = new Map<string, Array<{
    id: string;
    severity: (typeof alertRows)[number]["severity"];
    code: string;
    title: string;
    explanation: string;
    actionLabel: string;
    actionHref: string;
  }>>();
  for (const alert of alertRows) {
    const current = alertsByAssessment.get(alert.assessment_id) ?? [];
    current.push({
      id: alert.id,
      severity: alert.severity,
      code: alert.code,
      title: alert.title,
      explanation: alert.explanation,
      actionLabel: alert.action_label,
      actionHref: alert.action_href,
    });
    alertsByAssessment.set(alert.assessment_id, current);
  }
  return {
    snapshots: snapshots.map(mapSnapshot),
    assessments: assessments.map((assessment) => ({
      id: assessment.id,
      snapshotId: assessment.snapshot_id,
      period: assessment.period_month,
      version: Number(assessment.version),
      monthlyRevenueCents: Number(assessment.monthly_revenue_cents),
      estimatedProfitCents: Number(assessment.estimated_profit_cents),
      marginBasisPoints: nullableNumber(assessment.margin_basis_points),
      cashFlowCents: Number(assessment.cash_flow_cents),
      cashRunwayMonths: nullableNumber(assessment.cash_runway_months),
      customerLifetimeValueCents: nullableNumber(
        assessment.customer_lifetime_value_cents,
      ),
      customerAcquisitionCostCents: nullableNumber(
        assessment.customer_acquisition_cost_cents,
      ),
      marketingRoiBasisPoints: nullableNumber(
        assessment.marketing_roi_basis_points,
      ),
      salesRoiBasisPoints: nullableNumber(assessment.sales_roi_basis_points),
      websiteRoiBasisPoints: nullableNumber(
        assessment.website_roi_basis_points,
      ),
      automationRoiBasisPoints: nullableNumber(
        assessment.automation_roi_basis_points,
      ),
      pipelineValueCents: Number(assessment.pipeline_value_cents),
      weightedPipelineValueCents: Number(
        assessment.weighted_pipeline_value_cents,
      ),
      forecastThreeMonthsCents: Number(assessment.forecast_three_months_cents),
      confidence: Number(assessment.confidence),
      rationale: assessment.rationale,
      limitations: assessment.limitations,
      recommendedAction: assessment.recommended_action,
      generationVersion: assessment.generation_version,
      createdAt: assessment.created_at,
      evidence: evidenceByAssessment.get(assessment.id) ?? [],
      alerts: alertsByAssessment.get(assessment.id) ?? [],
    })),
  };
}

export async function recordFinancialInputSnapshot(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: FinancialInputSnapshotInput,
) {
  const parsed = financialInputSnapshotSchema.parse(input);
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [
      ...financialManageRoles,
    ]);
    const superseded = await supersedeCurrentFinancialSnapshots(
      transaction,
      tenantId,
      parsed.period,
    );
    const staleAssessments = await supersedeCurrentFinancialAssessments(
      transaction,
      tenantId,
      parsed.period,
    );
    const snapshotId = id("financial_snapshot");
    const version = await getNextFinancialSnapshotVersion(
      transaction,
      tenantId,
      parsed.period,
    );
    const now = nowIso();
    await insertFinancialSnapshot(transaction, {
      id: snapshotId,
      tenantId,
      period: parsed.period,
      version,
      supersedesId: superseded[0]?.id,
      parsed,
      actorId: userId,
      now,
    });
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "financial_ai.input_snapshot_recorded",
      targetType: "financial_input_snapshot",
      targetId: snapshotId,
      metadata: {
        period: parsed.period,
        version,
        revised: superseded.length > 0,
        staleAssessmentCount: staleAssessments.length,
        amountValuesRedacted: true,
      },
    });
    return { snapshotId, version };
  });
}

export async function generateFinancialAssessment(
  db: DbClient,
  userId: string,
  tenantId: string,
) {
  return withTenantDbTransaction(db, tenantId, userId, async (transaction) => {
    await assertTenantAccess(transaction, userId, tenantId, [
      ...financialManageRoles,
    ]);
    const snapshot = await findLatestCurrentFinancialSnapshot(
      transaction,
      tenantId,
    );
    if (!snapshot) {
      throw new FinancialAiError(
        "financial_input_required",
        "Enregistrez d'abord une photographie financière déclarée.",
      );
    }
    const [pipeline, brainEvidence] = await Promise.all([
      getFinancialPipelineSignal(transaction, tenantId),
      listFinancialBrainEvidence(transaction, tenantId),
    ]);
    const candidate = buildFinancialAssessmentCandidate({
      snapshot,
      pipeline,
      brainEvidence,
    });
    if (candidate.evidence.length === 0) {
      throw new FinancialAiError(
        "financial_evidence_required",
        "Une estimation financière doit contenir des preuves.",
      );
    }
    const duplicate = await findFinancialAssessmentByFingerprint(
      transaction,
      tenantId,
      candidate.fingerprint,
    );
    if (duplicate) {
      return { assessmentId: duplicate.id, created: false };
    }
    const superseded = await supersedeCurrentFinancialAssessments(
      transaction,
      tenantId,
      candidate.period,
    );
    const assessmentId = id("financial_assessment");
    const now = nowIso();
    await insertFinancialAssessment(transaction, {
      id: assessmentId,
      tenantId,
      candidate,
      version: await getNextFinancialAssessmentVersion(
        transaction,
        tenantId,
        candidate.period,
      ),
      supersedesId: superseded[0]?.id,
      actorId: userId,
      now,
      generationVersion: financialAiGenerationVersion,
    });
    for (const evidence of candidate.evidence) {
      await insertFinancialEvidence(transaction, {
        id: id("financial_evidence"),
        tenantId,
        assessmentId,
        evidence,
        now,
      });
    }
    for (const alert of candidate.alerts) {
      await insertFinancialAlert(transaction, {
        id: id("financial_alert"),
        tenantId,
        assessmentId,
        alert,
        now,
      });
    }
    await recordAuditLog(transaction, {
      tenantId,
      actorId: userId,
      action: "financial_ai.assessment_generated",
      targetType: "financial_assessment",
      targetId: assessmentId,
      metadata: {
        period: candidate.period,
        evidenceCount: candidate.evidence.length,
        alertCount: candidate.alerts.length,
        confidence: candidate.confidence,
        generationVersion: financialAiGenerationVersion,
        accountingWriteTriggered: false,
        externalActionTriggered: false,
        amountValuesRedacted: true,
      },
    });
    return { assessmentId, created: true };
  });
}

function mapSnapshot(snapshot: Awaited<ReturnType<typeof listCurrentFinancialSnapshots>>[number]) {
  return {
    id: snapshot.id,
    period: snapshot.period_month,
    version: Number(snapshot.version),
    monthlyRevenueCents: Number(snapshot.monthly_revenue_cents),
    operatingCostsCents: Number(snapshot.operating_costs_cents),
    cashBalanceCents: Number(snapshot.cash_balance_cents),
    cashInflowsCents: Number(snapshot.cash_inflows_cents),
    cashOutflowsCents: Number(snapshot.cash_outflows_cents),
    receivablesCents: Number(snapshot.receivables_cents),
    payablesCents: Number(snapshot.payables_cents),
    marketingSpendCents: Number(snapshot.marketing_spend_cents),
    salesSpendCents: Number(snapshot.sales_spend_cents),
    websiteSpendCents: Number(snapshot.website_spend_cents),
    automationSpendCents: Number(snapshot.automation_spend_cents),
    newCustomers: Number(snapshot.new_customers),
    activeCustomers: Number(snapshot.active_customers),
    averageLifetimeMonths: nullableNumber(snapshot.average_lifetime_months),
    marketingAttributedRevenueCents: nullableNumber(
      snapshot.marketing_attributed_revenue_cents,
    ),
    salesAttributedRevenueCents: nullableNumber(
      snapshot.sales_attributed_revenue_cents,
    ),
    websiteAttributedRevenueCents: nullableNumber(
      snapshot.website_attributed_revenue_cents,
    ),
    automationSavingsCents: nullableNumber(snapshot.automation_savings_cents),
    evidenceSummary: snapshot.evidence_summary,
    createdAt: snapshot.created_at,
  };
}

function nullableNumber(value: number | string | null) {
  return value === null ? null : Number(value);
}
