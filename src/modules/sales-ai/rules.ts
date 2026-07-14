import { hashToken, toJson } from "@/lib/security";
import type { SalesOpportunitySignal } from "@/modules/sales-ai/repository";
import type { SalesAiPriority } from "@/modules/sales-ai/schemas";

export type SalesAiEvidenceCandidate = {
  type:
    | "opportunity_stage"
    | "opportunity_value"
    | "follow_up"
    | "recent_activity"
    | "open_tasks"
    | "assignment";
  ref: string;
  label: string;
  observedValue: string;
};

export type SalesAssessmentCandidate = {
  opportunityId: string;
  fingerprint: string;
  score: number;
  closingEstimate: number;
  confidence: number;
  priority: SalesAiPriority;
  title: string;
  rationale: string;
  recommendedAction: string;
  riskSummary: string;
  actionLabel: string;
  actionHref: string;
  evidence: SalesAiEvidenceCandidate[];
};

export const salesAiGenerationVersion = "deterministic-crm-rules-v1";

export function buildSalesAssessmentCandidate(
  signal: SalesOpportunitySignal,
  now: Date,
): SalesAssessmentCandidate {
  const followUp = signal.nextFollowUpAt
    ? new Date(signal.nextFollowUpAt)
    : null;
  const lastActivity = signal.lastActivityAt
    ? new Date(signal.lastActivityAt)
    : null;
  const followUpOverdue = Boolean(followUp && followUp.getTime() < now.getTime());
  const activityAgeDays = lastActivity
    ? Math.max(0, Math.floor((now.getTime() - lastActivity.getTime()) / 86_400_000))
    : null;
  const followUpDays = followUp
    ? Math.ceil((followUp.getTime() - now.getTime()) / 86_400_000)
    : null;

  let score = 45;
  score += signal.valueCents > 0 ? 10 : -5;
  score += signal.assignedUserId ? 10 : -10;
  score += followUp ? (followUpOverdue ? -20 : 15) : -15;
  score += activityAgeDays === null ? -10 : activityAgeDays <= 7 ? 15 : activityAgeDays <= 30 ? 5 : -15;
  score -= Math.min(20, signal.overdueTaskCount * 5);

  const stageEstimate = [20, 35, 50, 65][Math.min(3, Math.max(0, signal.stagePosition - 1))]!;
  let closingEstimate = stageEstimate;
  closingEstimate += signal.valueCents > 0 ? 5 : 0;
  closingEstimate += signal.assignedUserId ? 5 : -5;
  closingEstimate += followUp ? (followUpOverdue ? -15 : 10) : -10;
  closingEstimate += activityAgeDays !== null && activityAgeDays <= 14 ? 10 : -10;
  closingEstimate -= Math.min(15, signal.overdueTaskCount * 5);

  const confidence = clamp(
    45 +
      15 +
      (signal.valueCents > 0 ? 10 : 0) +
      (followUp ? 10 : 0) +
      (lastActivity ? 10 : 0) +
      (signal.assignedUserId ? 10 : 0),
  );
  const priority = resolvePriority({
    followUpOverdue,
    hasFollowUp: Boolean(followUp),
    overdueTaskCount: signal.overdueTaskCount,
    activityAgeDays,
    assigned: Boolean(signal.assignedUserId),
  });
  const recommendedAction = resolveRecommendedAction({
    followUpOverdue,
    hasFollowUp: Boolean(followUp),
    overdueTaskCount: signal.overdueTaskCount,
    activityAgeDays,
    assigned: Boolean(signal.assignedUserId),
  });
  const riskSummary = resolveRiskSummary({
    followUpOverdue,
    hasFollowUp: Boolean(followUp),
    overdueTaskCount: signal.overdueTaskCount,
    activityAgeDays,
    assigned: Boolean(signal.assignedUserId),
  });
  const evidence: SalesAiEvidenceCandidate[] = [
    {
      type: "opportunity_stage",
      ref: signal.stageId,
      label: "Etape du pipeline",
      observedValue: `${signal.stageName} (position ${signal.stagePosition})`,
    },
    {
      type: "opportunity_value",
      ref: signal.opportunityId,
      label: "Valeur enregistrée",
      observedValue: `${(signal.valueCents / 100).toFixed(2)} EUR`,
    },
    {
      type: "follow_up",
      ref: signal.opportunityId,
      label: "Prochaine action",
      observedValue: followUp
        ? followUpOverdue
          ? `En retard de ${Math.max(1, Math.abs(followUpDays ?? 0))} jour(s)`
          : `Dans ${Math.max(0, followUpDays ?? 0)} jour(s)`
        : "Non planifiée",
    },
    {
      type: "recent_activity",
      ref: signal.opportunityId,
      label: "Derniere activite",
      observedValue:
        activityAgeDays === null
          ? "Aucune activité enregistrée"
          : `Il y a ${activityAgeDays} jour(s)`,
    },
    {
      type: "open_tasks",
      ref: signal.opportunityId,
      label: "Taches de suivi",
      observedValue: `${signal.openTaskCount} ouverte(s), ${signal.overdueTaskCount} en retard`,
    },
    {
      type: "assignment",
      ref: signal.opportunityId,
      label: "Responsable",
      observedValue: signal.assignedUserId ? "Assigné" : "Non assigné",
    },
  ];
  const fingerprint = hashToken(
    toJson({
      opportunityId: signal.opportunityId,
      stageId: signal.stageId,
      stagePosition: signal.stagePosition,
      valueCents: signal.valueCents,
      nextFollowUpAt: signal.nextFollowUpAt,
      lastActivityAt: signal.lastActivityAt,
      openTaskCount: signal.openTaskCount,
      overdueTaskCount: signal.overdueTaskCount,
      assigned: Boolean(signal.assignedUserId),
      analysisDay: now.toISOString().slice(0, 10),
      generationVersion: salesAiGenerationVersion,
    }),
  );

  return {
    opportunityId: signal.opportunityId,
    fingerprint,
    score: clamp(score),
    closingEstimate: clamp(closingEstimate, 5, 90),
    confidence,
    priority,
    title: `Suivi commercial : ${signal.contactName}`,
    rationale: `L'opportunité est à l'étape « ${signal.stageName} ». Le score combine uniquement l'étape, la valeur, la prochaine action, l'activité, les tâches et l'assignation actuellement enregistrées.`,
    recommendedAction,
    riskSummary,
    actionLabel: "Ouvrir l'opportunité",
    actionHref: `/opportunites/${signal.opportunityId}`,
    evidence,
  };
}

type DecisionSignals = {
  followUpOverdue: boolean;
  hasFollowUp: boolean;
  overdueTaskCount: number;
  activityAgeDays: number | null;
  assigned: boolean;
};

function resolvePriority(signals: DecisionSignals): SalesAiPriority {
  if (signals.followUpOverdue || signals.overdueTaskCount > 0) return "high";
  if (!signals.hasFollowUp || !signals.assigned || signals.activityAgeDays === null || signals.activityAgeDays > 14) {
    return "medium";
  }
  return "low";
}

function resolveRecommendedAction(signals: DecisionSignals) {
  if (signals.followUpOverdue) {
    return "Replanifier la prochaine action et vérifier manuellement le contexte avant toute prise de contact.";
  }
  if (signals.overdueTaskCount > 0) {
    return "Traiter les tâches en retard puis confirmer la prochaine étape avec le responsable.";
  }
  if (!signals.hasFollowUp) {
    return "Définir une prochaine action datée dans l'opportunité.";
  }
  if (!signals.assigned) {
    return "Désigner un responsable avant de poursuivre le suivi commercial.";
  }
  if (signals.activityAgeDays === null || signals.activityAgeDays > 14) {
    return "Relire l'historique et préparer un suivi humain adapté au contexte et au consentement.";
  }
  return "Préparer le prochain échange à partir des informations déjà vérifiées dans le CRM.";
}

function resolveRiskSummary(signals: DecisionSignals) {
  const risks: string[] = [];
  if (signals.followUpOverdue) risks.push("prochaine action en retard");
  if (!signals.hasFollowUp) risks.push("aucune prochaine action datée");
  if (signals.overdueTaskCount > 0) risks.push(`${signals.overdueTaskCount} tâche(s) en retard`);
  if (!signals.assigned) risks.push("opportunité non assignée");
  if (signals.activityAgeDays === null) risks.push("aucune activité enregistrée");
  else if (signals.activityAgeDays > 14) risks.push("activité commerciale ancienne");
  return risks.length > 0
    ? `Vigilance : ${risks.join(", ")}. Aucun contact n'est déclenché automatiquement.`
    : "Aucun signal de suivi critique détecté. Le score reste indicatif et ne déclenche aucune action.";
}

function clamp(value: number, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, value));
}
