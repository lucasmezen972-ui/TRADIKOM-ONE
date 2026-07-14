import type { DbClient } from "@/lib/db";
import type {
  FinancialAlertCandidate,
  FinancialAssessmentCandidate,
  FinancialEvidenceCandidate,
} from "@/modules/financial-ai/rules";
import type { FinancialAlertSeverity } from "@/modules/financial-ai/schemas";

export type FinancialInputSnapshotRow = {
  id: string;
  tenant_id: string;
  period_month: string;
  status: "current" | "superseded";
  version: number | string;
  supersedes_id: string | null;
  monthly_revenue_cents: number | string;
  operating_costs_cents: number | string;
  cash_balance_cents: number | string;
  cash_inflows_cents: number | string;
  cash_outflows_cents: number | string;
  receivables_cents: number | string;
  payables_cents: number | string;
  marketing_spend_cents: number | string;
  sales_spend_cents: number | string;
  website_spend_cents: number | string;
  automation_spend_cents: number | string;
  new_customers: number | string;
  active_customers: number | string;
  average_lifetime_months: number | string | null;
  marketing_attributed_revenue_cents: number | string | null;
  sales_attributed_revenue_cents: number | string | null;
  website_attributed_revenue_cents: number | string | null;
  automation_savings_cents: number | string | null;
  evidence_summary: string;
  recorded_by: string;
  created_at: string;
};

export type FinancialPipelineSignal = {
  opportunityCount: number;
  assessedOpportunityCount: number;
  pipelineValueCents: number;
  weightedPipelineValueCents: number;
};

export type FinancialBrainEvidenceRow = {
  id: string;
  domain: "pricing" | "margins" | "objectives" | "kpis";
  title: string;
  version: number;
};

export type FinancialAssessmentRow = {
  id: string;
  tenant_id: string;
  snapshot_id: string;
  period_month: string;
  status: "current" | "superseded";
  version: number | string;
  supersedes_id: string | null;
  monthly_revenue_cents: number | string;
  estimated_profit_cents: number | string;
  margin_basis_points: number | string | null;
  cash_flow_cents: number | string;
  cash_runway_months: number | string | null;
  customer_lifetime_value_cents: number | string | null;
  customer_acquisition_cost_cents: number | string | null;
  marketing_roi_basis_points: number | string | null;
  sales_roi_basis_points: number | string | null;
  website_roi_basis_points: number | string | null;
  automation_roi_basis_points: number | string | null;
  pipeline_value_cents: number | string;
  weighted_pipeline_value_cents: number | string;
  forecast_three_months_cents: number | string;
  confidence: number | string;
  rationale: string;
  limitations: string;
  recommended_action: string;
  generation_version: string;
  created_at: string;
};

export type FinancialEvidenceRow = {
  id: string;
  assessment_id: string;
  evidence_type: FinancialEvidenceCandidate["type"];
  source_ref: string;
  label: string;
  observed_value: string;
};

export type FinancialAlertRow = {
  id: string;
  assessment_id: string;
  severity: FinancialAlertSeverity;
  code: string;
  title: string;
  explanation: string;
  action_label: string;
  action_href: string;
};

export async function listCurrentFinancialSnapshots(db: DbClient, tenantId: string) {
  const result = await db.query<FinancialInputSnapshotRow>(
    `select * from financial_input_snapshots
     where tenant_id = $1 and status = 'current'
     order by period_month desc, version desc limit 24`,
    [tenantId],
  );
  return result.rows;
}

export async function findLatestCurrentFinancialSnapshot(
  db: DbClient,
  tenantId: string,
) {
  const result = await db.query<FinancialInputSnapshotRow>(
    `select * from financial_input_snapshots
     where tenant_id = $1 and status = 'current'
     order by period_month desc, version desc limit 1`,
    [tenantId],
  );
  return result.rows[0] ?? null;
}

export async function getNextFinancialSnapshotVersion(
  db: DbClient,
  tenantId: string,
  period: string,
) {
  const result = await db.query<{ version: number | string }>(
    `select coalesce(max(version), 0) + 1 as version
     from financial_input_snapshots where tenant_id = $1 and period_month = $2`,
    [tenantId, period],
  );
  return Number(result.rows[0]?.version ?? 1);
}

export async function supersedeCurrentFinancialSnapshots(
  db: DbClient,
  tenantId: string,
  period: string,
) {
  const result = await db.query<{ id: string }>(
    `update financial_input_snapshots set status = 'superseded'
     where tenant_id = $1 and period_month = $2 and status = 'current'
     returning id`,
    [tenantId, period],
  );
  return result.rows;
}

export async function insertFinancialSnapshot(db: DbClient, input: {
  id: string;
  tenantId: string;
  period: string;
  version: number;
  supersedesId?: string;
  parsed: {
    monthlyRevenueCents: number;
    operatingCostsCents: number;
    cashBalanceCents: number;
    cashInflowsCents: number;
    cashOutflowsCents: number;
    receivablesCents: number;
    payablesCents: number;
    marketingSpendCents: number;
    salesSpendCents: number;
    websiteSpendCents: number;
    automationSpendCents: number;
    newCustomers: number;
    activeCustomers: number;
    averageLifetimeMonths: number | null;
    marketingAttributedRevenueCents: number | null;
    salesAttributedRevenueCents: number | null;
    websiteAttributedRevenueCents: number | null;
    automationSavingsCents: number | null;
    evidenceSummary: string;
  };
  actorId: string;
  now: string;
}) {
  const value = input.parsed;
  await db.query(
    `insert into financial_input_snapshots (
       id, tenant_id, period_month, status, version, supersedes_id,
       monthly_revenue_cents, operating_costs_cents, cash_balance_cents,
       cash_inflows_cents, cash_outflows_cents, receivables_cents,
       payables_cents, marketing_spend_cents, sales_spend_cents,
       website_spend_cents, automation_spend_cents, new_customers,
       active_customers, average_lifetime_months,
       marketing_attributed_revenue_cents, sales_attributed_revenue_cents,
       website_attributed_revenue_cents, automation_savings_cents,
       evidence_summary, recorded_by, created_at
     ) values (
       $1, $2, $3, 'current', $4, $5, $6, $7, $8, $9, $10, $11, $12,
       $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26
     )`,
    [
      input.id,
      input.tenantId,
      input.period,
      input.version,
      input.supersedesId ?? null,
      value.monthlyRevenueCents,
      value.operatingCostsCents,
      value.cashBalanceCents,
      value.cashInflowsCents,
      value.cashOutflowsCents,
      value.receivablesCents,
      value.payablesCents,
      value.marketingSpendCents,
      value.salesSpendCents,
      value.websiteSpendCents,
      value.automationSpendCents,
      value.newCustomers,
      value.activeCustomers,
      value.averageLifetimeMonths,
      value.marketingAttributedRevenueCents,
      value.salesAttributedRevenueCents,
      value.websiteAttributedRevenueCents,
      value.automationSavingsCents,
      value.evidenceSummary,
      input.actorId,
      input.now,
    ],
  );
}

export async function getFinancialPipelineSignal(db: DbClient, tenantId: string) {
  const result = await db.query<{
    opportunity_count: number | string;
    assessed_opportunity_count: number | string;
    pipeline_value_cents: number | string;
    weighted_pipeline_value_cents: number | string;
  }>(
    `select
       count(opportunities.id)::int as opportunity_count,
       count(sales_ai_assessments.id)::int as assessed_opportunity_count,
       coalesce(sum(opportunities.value_cents), 0)::bigint as pipeline_value_cents,
       coalesce(sum(
         case when sales_ai_assessments.id is null then 0
         else round(opportunities.value_cents * sales_ai_assessments.closing_estimate / 100.0)
         end
       ), 0)::bigint as weighted_pipeline_value_cents
     from opportunities
     left join sales_ai_assessments
       on sales_ai_assessments.tenant_id = opportunities.tenant_id
      and sales_ai_assessments.opportunity_id = opportunities.id
      and sales_ai_assessments.status = 'current'
     where opportunities.tenant_id = $1 and opportunities.lost_reason is null`,
    [tenantId],
  );
  const row = result.rows[0];
  return {
    opportunityCount: Number(row?.opportunity_count ?? 0),
    assessedOpportunityCount: Number(row?.assessed_opportunity_count ?? 0),
    pipelineValueCents: Number(row?.pipeline_value_cents ?? 0),
    weightedPipelineValueCents: Number(row?.weighted_pipeline_value_cents ?? 0),
  } satisfies FinancialPipelineSignal;
}

export async function listFinancialBrainEvidence(db: DbClient, tenantId: string) {
  const result = await db.query<FinancialBrainEvidenceRow>(
    `select id, domain, title, version from business_brain_entries
     where tenant_id = $1 and status = 'active'
       and domain in ('pricing', 'margins', 'objectives', 'kpis')
     order by updated_at desc, id asc limit 20`,
    [tenantId],
  );
  return result.rows;
}

export async function listCurrentFinancialAssessments(db: DbClient, tenantId: string) {
  const result = await db.query<FinancialAssessmentRow>(
    `select * from financial_assessments
     where tenant_id = $1 and status = 'current'
     order by period_month desc, version desc limit 24`,
    [tenantId],
  );
  return result.rows;
}

export async function listCurrentFinancialEvidence(db: DbClient, tenantId: string) {
  const result = await db.query<FinancialEvidenceRow>(
    `select evidence.id, evidence.assessment_id, evidence.evidence_type,
       evidence.source_ref, evidence.label, evidence.observed_value
     from financial_assessment_evidence as evidence
     join financial_assessments as assessments
       on assessments.tenant_id = evidence.tenant_id
      and assessments.id = evidence.assessment_id
     where evidence.tenant_id = $1 and assessments.status = 'current'
     order by evidence.created_at asc, evidence.id asc`,
    [tenantId],
  );
  return result.rows;
}

export async function listCurrentFinancialAlerts(db: DbClient, tenantId: string) {
  const result = await db.query<FinancialAlertRow>(
    `select alerts.id, alerts.assessment_id, alerts.severity, alerts.code,
       alerts.title, alerts.explanation, alerts.action_label, alerts.action_href
     from financial_alerts as alerts
     join financial_assessments as assessments
       on assessments.tenant_id = alerts.tenant_id
      and assessments.id = alerts.assessment_id
     where alerts.tenant_id = $1 and assessments.status = 'current'
     order by case alerts.severity when 'critical' then 1 when 'warning' then 2 else 3 end,
       alerts.created_at asc`,
    [tenantId],
  );
  return result.rows;
}

export async function findFinancialAssessmentByFingerprint(
  db: DbClient,
  tenantId: string,
  fingerprint: string,
) {
  const result = await db.query<{ id: string }>(
    `select id from financial_assessments
     where tenant_id = $1 and fingerprint = $2`,
    [tenantId, fingerprint],
  );
  return result.rows[0] ?? null;
}

export async function getNextFinancialAssessmentVersion(
  db: DbClient,
  tenantId: string,
  period: string,
) {
  const result = await db.query<{ version: number | string }>(
    `select coalesce(max(version), 0) + 1 as version
     from financial_assessments where tenant_id = $1 and period_month = $2`,
    [tenantId, period],
  );
  return Number(result.rows[0]?.version ?? 1);
}

export async function supersedeCurrentFinancialAssessments(
  db: DbClient,
  tenantId: string,
  period: string,
) {
  const result = await db.query<{ id: string }>(
    `update financial_assessments set status = 'superseded'
     where tenant_id = $1 and period_month = $2 and status = 'current'
     returning id`,
    [tenantId, period],
  );
  return result.rows;
}

export async function insertFinancialAssessment(db: DbClient, input: {
  id: string;
  tenantId: string;
  candidate: FinancialAssessmentCandidate;
  version: number;
  supersedesId?: string;
  actorId: string;
  now: string;
  generationVersion: string;
}) {
  const candidate = input.candidate;
  await db.query(
    `insert into financial_assessments (
       id, tenant_id, snapshot_id, period_month, fingerprint, status, version,
       supersedes_id, monthly_revenue_cents, estimated_profit_cents,
       margin_basis_points, cash_flow_cents, cash_runway_months,
       customer_lifetime_value_cents, customer_acquisition_cost_cents,
       marketing_roi_basis_points, sales_roi_basis_points,
       website_roi_basis_points, automation_roi_basis_points,
       pipeline_value_cents, weighted_pipeline_value_cents,
       forecast_three_months_cents, confidence, rationale, limitations,
       recommended_action, generation_version, generated_by, created_at, updated_at
     ) values (
       $1, $2, $3, $4, $5, 'current', $6, $7, $8, $9, $10, $11, $12,
       $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24, $25,
       $26, $27, $28, $28
     )`,
    [
      input.id,
      input.tenantId,
      candidate.snapshotId,
      candidate.period,
      candidate.fingerprint,
      input.version,
      input.supersedesId ?? null,
      candidate.monthlyRevenueCents,
      candidate.estimatedProfitCents,
      candidate.marginBasisPoints,
      candidate.cashFlowCents,
      candidate.cashRunwayMonths,
      candidate.customerLifetimeValueCents,
      candidate.customerAcquisitionCostCents,
      candidate.marketingRoiBasisPoints,
      candidate.salesRoiBasisPoints,
      candidate.websiteRoiBasisPoints,
      candidate.automationRoiBasisPoints,
      candidate.pipelineValueCents,
      candidate.weightedPipelineValueCents,
      candidate.forecastThreeMonthsCents,
      candidate.confidence,
      candidate.rationale,
      candidate.limitations,
      candidate.recommendedAction,
      input.generationVersion,
      input.actorId,
      input.now,
    ],
  );
}

export async function insertFinancialEvidence(db: DbClient, input: {
  id: string;
  tenantId: string;
  assessmentId: string;
  evidence: FinancialEvidenceCandidate;
  now: string;
}) {
  await db.query(
    `insert into financial_assessment_evidence (
       id, tenant_id, assessment_id, evidence_type, source_ref, label,
       observed_value, captured_at, created_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $8)`,
    [
      input.id,
      input.tenantId,
      input.assessmentId,
      input.evidence.type,
      input.evidence.sourceRef,
      input.evidence.label,
      input.evidence.observedValue,
      input.now,
    ],
  );
}

export async function insertFinancialAlert(db: DbClient, input: {
  id: string;
  tenantId: string;
  assessmentId: string;
  alert: FinancialAlertCandidate;
  now: string;
}) {
  await db.query(
    `insert into financial_alerts (
       id, tenant_id, assessment_id, severity, code, title, explanation,
       action_label, action_href, created_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      input.id,
      input.tenantId,
      input.assessmentId,
      input.alert.severity,
      input.alert.code,
      input.alert.title,
      input.alert.explanation,
      input.alert.actionLabel,
      input.alert.actionHref,
      input.now,
    ],
  );
}
