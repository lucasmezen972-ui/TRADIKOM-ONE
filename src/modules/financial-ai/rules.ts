import { hashToken, toJson } from "@/lib/security";
import type {
  FinancialBrainEvidenceRow,
  FinancialInputSnapshotRow,
  FinancialPipelineSignal,
} from "@/modules/financial-ai/repository";
import type { FinancialAlertSeverity } from "@/modules/financial-ai/schemas";

export const financialAiGenerationVersion = "declared-finance-and-crm-v1";

export type FinancialEvidenceCandidate = {
  type: "declared_input" | "crm_pipeline" | "business_brain" | "formula";
  sourceRef: string;
  label: string;
  observedValue: string;
};

export type FinancialAlertCandidate = {
  severity: FinancialAlertSeverity;
  code: string;
  title: string;
  explanation: string;
  actionLabel: string;
  actionHref: string;
};

export type FinancialAssessmentCandidate = {
  period: string;
  snapshotId: string;
  fingerprint: string;
  monthlyRevenueCents: number;
  estimatedProfitCents: number;
  marginBasisPoints: number | null;
  cashFlowCents: number;
  cashRunwayMonths: number | null;
  customerLifetimeValueCents: number | null;
  customerAcquisitionCostCents: number | null;
  marketingRoiBasisPoints: number | null;
  salesRoiBasisPoints: number | null;
  websiteRoiBasisPoints: number | null;
  automationRoiBasisPoints: number | null;
  pipelineValueCents: number;
  weightedPipelineValueCents: number;
  forecastThreeMonthsCents: number;
  confidence: number;
  rationale: string;
  limitations: string;
  recommendedAction: string;
  evidence: FinancialEvidenceCandidate[];
  alerts: FinancialAlertCandidate[];
};

export function buildFinancialAssessmentCandidate(input: {
  snapshot: FinancialInputSnapshotRow;
  pipeline: FinancialPipelineSignal;
  brainEvidence: FinancialBrainEvidenceRow[];
}): FinancialAssessmentCandidate {
  const snapshot = input.snapshot;
  const revenue = Number(snapshot.monthly_revenue_cents);
  const costs = Number(snapshot.operating_costs_cents);
  const cashBalance = Number(snapshot.cash_balance_cents);
  const cashFlow =
    Number(snapshot.cash_inflows_cents) - Number(snapshot.cash_outflows_cents);
  const profit = revenue - costs;
  const marginBasisPoints = revenue > 0
    ? Math.round((profit / revenue) * 10_000)
    : null;
  const cashRunwayMonths = cashFlow < 0 && cashBalance > 0
    ? Math.max(1, Math.floor(cashBalance / Math.abs(cashFlow)))
    : null;
  const activeCustomers = Number(snapshot.active_customers);
  const averageLifetimeMonths = nullableNumber(snapshot.average_lifetime_months);
  const customerLifetimeValueCents =
    activeCustomers > 0 && averageLifetimeMonths !== null
      ? Math.round((revenue / activeCustomers) * averageLifetimeMonths)
      : null;
  const newCustomers = Number(snapshot.new_customers);
  const acquisitionSpend =
    Number(snapshot.marketing_spend_cents) + Number(snapshot.sales_spend_cents);
  const customerAcquisitionCostCents = newCustomers > 0
    ? Math.round(acquisitionSpend / newCustomers)
    : null;
  const marketingRoiBasisPoints = calculateRoiBasisPoints(
    Number(snapshot.marketing_spend_cents),
    nullableNumber(snapshot.marketing_attributed_revenue_cents),
  );
  const salesRoiBasisPoints = calculateRoiBasisPoints(
    Number(snapshot.sales_spend_cents),
    nullableNumber(snapshot.sales_attributed_revenue_cents),
  );
  const websiteRoiBasisPoints = calculateRoiBasisPoints(
    Number(snapshot.website_spend_cents),
    nullableNumber(snapshot.website_attributed_revenue_cents),
  );
  const automationRoiBasisPoints = calculateRoiBasisPoints(
    Number(snapshot.automation_spend_cents),
    nullableNumber(snapshot.automation_savings_cents),
  );
  const pipelineValueCents = Number(input.pipeline.pipelineValueCents);
  const weightedPipelineValueCents = Number(
    input.pipeline.weightedPipelineValueCents,
  );
  const forecastThreeMonthsCents = revenue * 3 + weightedPipelineValueCents;
  const confidence = Math.min(
    90,
    55 +
      (activeCustomers > 0 ? 5 : 0) +
      (averageLifetimeMonths !== null ? 5 : 0) +
      (input.pipeline.assessedOpportunityCount > 0 ? 10 : 0) +
      (input.brainEvidence.length > 0 ? 10 : 0),
  );
  const alerts = buildAlerts({
    profit,
    marginBasisPoints,
    cashFlow,
    cashRunwayMonths,
    receivablesCents: Number(snapshot.receivables_cents),
    payablesCents: Number(snapshot.payables_cents),
    marketingSpendCents: Number(snapshot.marketing_spend_cents),
    marketingRoiBasisPoints,
    salesSpendCents: Number(snapshot.sales_spend_cents),
    salesRoiBasisPoints,
    websiteSpendCents: Number(snapshot.website_spend_cents),
    websiteRoiBasisPoints,
    automationSpendCents: Number(snapshot.automation_spend_cents),
    automationRoiBasisPoints,
  });
  const evidence = buildEvidence({
    snapshot,
    pipeline: input.pipeline,
    brainEvidence: input.brainEvidence,
  });

  return {
    period: snapshot.period_month,
    snapshotId: snapshot.id,
    fingerprint: hashToken(
      toJson({
        snapshotId: snapshot.id,
        pipeline: input.pipeline,
        brainEvidence: input.brainEvidence.map((item) => ({
          id: item.id,
          version: item.version,
        })),
        generationVersion: financialAiGenerationVersion,
      }),
    ),
    monthlyRevenueCents: revenue,
    estimatedProfitCents: profit,
    marginBasisPoints,
    cashFlowCents: cashFlow,
    cashRunwayMonths,
    customerLifetimeValueCents,
    customerAcquisitionCostCents,
    marketingRoiBasisPoints,
    salesRoiBasisPoints,
    websiteRoiBasisPoints,
    automationRoiBasisPoints,
    pipelineValueCents,
    weightedPipelineValueCents,
    forecastThreeMonthsCents,
    confidence,
    rationale:
      "Les estimations combinent uniquement les montants déclarés pour la période, la valeur enregistrée des opportunités et les probabilités courantes de Sales AI. La projection à trois mois additionne trois mois de revenu déclaré au pipeline pondéré disponible.",
    limitations:
      "Ces indicateurs ne constituent ni une comptabilité, ni une situation bancaire, ni une prévision certifiée. Les ROI restent indisponibles sans revenu ou économie explicitement attribué, et le pipeline ne tient pas compte d'un calendrier d'encaissement.",
    recommendedAction: resolveRecommendedAction(alerts),
    evidence,
    alerts,
  };
}

function calculateRoiBasisPoints(spend: number, attributedGain: number | null) {
  if (spend <= 0 || attributedGain === null) return null;
  return Math.round(((attributedGain - spend) / spend) * 10_000);
}

function buildEvidence(input: {
  snapshot: FinancialInputSnapshotRow;
  pipeline: FinancialPipelineSignal;
  brainEvidence: FinancialBrainEvidenceRow[];
}): FinancialEvidenceCandidate[] {
  const snapshot = input.snapshot;
  const evidence: FinancialEvidenceCandidate[] = [
    {
      type: "declared_input",
      sourceRef: snapshot.id,
      label: "Période déclarée",
      observedValue: `${snapshot.period_month} · version ${snapshot.version}`,
    },
    {
      type: "declared_input",
      sourceRef: snapshot.id,
      label: "Revenu et charges déclarés",
      observedValue: `${formatEuros(snapshot.monthly_revenue_cents)} · ${formatEuros(snapshot.operating_costs_cents)}`,
    },
    {
      type: "declared_input",
      sourceRef: snapshot.id,
      label: "Encaissements et décaissements déclarés",
      observedValue: `${formatEuros(snapshot.cash_inflows_cents)} · ${formatEuros(snapshot.cash_outflows_cents)}`,
    },
    {
      type: "declared_input",
      sourceRef: snapshot.id,
      label: "Justificatif interne",
      observedValue: snapshot.evidence_summary,
    },
    {
      type: "crm_pipeline",
      sourceRef: "crm:opportunities",
      label: "Pipeline CRM enregistré",
      observedValue: `${input.pipeline.opportunityCount} opportunité(s) · ${formatEuros(input.pipeline.pipelineValueCents)}`,
    },
    {
      type: "formula",
      sourceRef: financialAiGenerationVersion,
      label: "Pipeline pondéré Sales AI",
      observedValue: `${input.pipeline.assessedOpportunityCount}/${input.pipeline.opportunityCount} opportunité(s) évaluée(s) · ${formatEuros(input.pipeline.weightedPipelineValueCents)}`,
    },
  ];
  for (const item of input.brainEvidence.slice(0, 10)) {
    evidence.push({
      type: "business_brain",
      sourceRef: item.id,
      label: `Cerveau d'entreprise · ${item.domain}`,
      observedValue: `${item.title} · v${item.version}`,
    });
  }
  return evidence;
}

function buildAlerts(input: {
  profit: number;
  marginBasisPoints: number | null;
  cashFlow: number;
  cashRunwayMonths: number | null;
  receivablesCents: number;
  payablesCents: number;
  marketingSpendCents: number;
  marketingRoiBasisPoints: number | null;
  salesSpendCents: number;
  salesRoiBasisPoints: number | null;
  websiteSpendCents: number;
  websiteRoiBasisPoints: number | null;
  automationSpendCents: number;
  automationRoiBasisPoints: number | null;
}): FinancialAlertCandidate[] {
  const alerts: FinancialAlertCandidate[] = [];
  if (input.cashFlow < 0) {
    alerts.push({
      severity: input.cashRunwayMonths !== null && input.cashRunwayMonths <= 3
        ? "critical"
        : "warning",
      code: "negative_cash_flow",
      title: "Flux de trésorerie déclaré négatif",
      explanation: input.cashRunwayMonths === null
        ? "Les décaissements déclarés dépassent les encaissements et aucune autonomie fiable ne peut être calculée."
        : `Les décaissements dépassent les encaissements. L'autonomie indicative est de ${input.cashRunwayMonths} mois au rythme déclaré.`,
      actionLabel: "Revoir les entrées financières",
      actionHref: "/pilotage-financier",
    });
  }
  if (input.profit < 0) {
    alerts.push({
      severity: "critical",
      code: "negative_profit",
      title: "Résultat mensuel estimé négatif",
      explanation:
        "Les charges déclarées dépassent le revenu mensuel déclaré. Vérifiez les montants avant toute décision.",
      actionLabel: "Analyser les charges",
      actionHref: "/pilotage-financier",
    });
  } else if (input.marginBasisPoints !== null && input.marginBasisPoints < 1_000) {
    alerts.push({
      severity: "warning",
      code: "low_margin",
      title: "Marge estimée sous 10 %",
      explanation:
        "La marge calculée sur les montants déclarés laisse peu de latitude. Cette lecture doit être rapprochée de la comptabilité.",
      actionLabel: "Vérifier la marge",
      actionHref: "/pilotage-financier",
    });
  }
  if (input.payablesCents > input.receivablesCents && input.payablesCents > 0) {
    alerts.push({
      severity: "warning",
      code: "payables_above_receivables",
      title: "Décalage clients-fournisseurs à surveiller",
      explanation:
        "Les dettes fournisseurs déclarées dépassent les créances clients déclarées pour cette photographie.",
      actionLabel: "Contrôler les échéances",
      actionHref: "/pilotage-financier",
    });
  }
  const missingAttribution = [
    [input.marketingSpendCents, input.marketingRoiBasisPoints, "marketing"],
    [input.salesSpendCents, input.salesRoiBasisPoints, "commercial"],
    [input.websiteSpendCents, input.websiteRoiBasisPoints, "site web"],
    [input.automationSpendCents, input.automationRoiBasisPoints, "automatisation"],
  ].filter(([spend, roi]) => Number(spend) > 0 && roi === null);
  if (missingAttribution.length > 0) {
    alerts.push({
      severity: "info",
      code: "missing_attribution",
      title: "Attribution ROI incomplète",
      explanation: `Un coût est déclaré sans gain attribué pour : ${missingAttribution.map((item) => item[2]).join(", ")}. Aucun ROI n'est inventé.`,
      actionLabel: "Compléter les données",
      actionHref: "/pilotage-financier",
    });
  }
  return alerts;
}

function resolveRecommendedAction(alerts: FinancialAlertCandidate[]) {
  const critical = alerts.find((alert) => alert.severity === "critical");
  if (critical) return critical.explanation;
  const warning = alerts.find((alert) => alert.severity === "warning");
  if (warning) return warning.explanation;
  return "Comparer cette estimation aux données comptables validées avant de prendre une décision financière.";
}

function nullableNumber(value: number | string | null) {
  return value === null ? null : Number(value);
}

function formatEuros(value: number | string) {
  return `${(Number(value) / 100).toFixed(2)} EUR`;
}
