import { hashToken, toJson } from "@/lib/security";
import type { getBusinessBrain } from "@/modules/business-brain";
import type {
  StrategicAdvisorRole,
  StrategicEffort,
} from "@/modules/strategic-advisor/schemas";

type BusinessBrainWorkspace = Awaited<ReturnType<typeof getBusinessBrain>>;

export type StrategicEvidenceCandidate = {
  type: "business_brain_entry" | "system_metric" | "audit_record" | "api_source";
  ref: string;
  label: string;
  observedValue: string;
};

export type StrategicRecommendationCandidate = {
  ruleKey: string;
  role: StrategicAdvisorRole;
  title: string;
  rationale: string;
  expectedGain: string;
  effort: StrategicEffort;
  roiSummary: string;
  riskSummary: string;
  confidence: number;
  actionLabel: string;
  actionHref: string;
  evidence: StrategicEvidenceCandidate[];
  fingerprint: string;
};

export const strategicAdvisorGenerationVersion = "deterministic-rules-v1";

export function buildStrategicRecommendationCandidates(
  workspace: BusinessBrainWorkspace,
) {
  const candidates: Omit<StrategicRecommendationCandidate, "fingerprint">[] = [];
  const missingDomains = workspace.coverage.filter(
    (item) => item.status === "missing",
  );

  if (missingDomains.length > 0) {
    const covered = workspace.coverage.length - missingDomains.length;
    candidates.push({
      ruleKey: "executive.knowledge_coverage",
      role: "executive",
      title: "Sécuriser les données de décision",
      rationale: `${missingDomains.length} domaines métier sur ${workspace.coverage.length} ne disposent encore d'aucune source vérifiée. Les décisions stratégiques doivent rester limitées aux données disponibles tant que cette couverture n'est pas complétée.`,
      expectedGain:
        "Réduire les décisions fondées sur des hypothèses et préparer des analyses plus fiables.",
      effort: missingDomains.length > 7 ? "high" : "medium",
      roiSummary:
        "ROI indirect élevé : moins de reprises, de contradictions et de décisions mal informées.",
      riskSummary:
        "Risque faible ; la principale contrainte est le temps de qualification des sources.",
      confidence: 100,
      actionLabel: "Compléter la mémoire",
      actionHref: "/cerveau-entreprise",
      evidence: [
        {
          type: "system_metric",
          ref: "business_brain.coverage",
          label: "Couverture métier vérifiée",
          observedValue: `${covered}/${workspace.coverage.length} domaines couverts`,
        },
      ],
    });
  }

  const objective = workspace.entries.find(
    (entry) => entry.domain === "objectives",
  );
  if (objective) {
    candidates.push({
      ruleKey: `executive.objective.${objective.entryKey}`,
      role: "executive",
      title: `Transformer « ${objective.title} » en plan mesurable`,
      rationale:
        "Un objectif vérifié existe dans la mémoire, mais sa traduction en jalons et indicateurs doit être explicitement planifiée avant toute automatisation.",
      expectedGain:
        "Donner à l'équipe une cible commune, des points de contrôle et une mesure d'avancement.",
      effort: "medium",
      roiSummary:
        "ROI à confirmer après définition de la valeur cible, du délai et du coût d'exécution.",
      riskSummary:
        "Risque moyen si l'objectif est poursuivi sans indicateur, responsable ou échéance validés.",
      confidence: objective.confidence,
      actionLabel: "Revoir l'objectif",
      actionHref: "/cerveau-entreprise",
      evidence: [
        {
          type: "business_brain_entry",
          ref: objective.id,
          label: objective.title,
          observedValue: `Version ${objective.version}, confiance ${objective.confidence}%`,
        },
      ],
    });
  }

  if (
    workspace.signals.opportunities > 0 &&
    workspace.signals.pipelineValueCents > 0
  ) {
    candidates.push({
      ruleKey: "sales.pipeline_follow_up",
      role: "sales",
      title: "Prioriser le suivi du pipeline commercial",
      rationale: `${workspace.signals.opportunities} opportunité${workspace.signals.opportunities > 1 ? "s" : ""} représente${workspace.signals.opportunities > 1 ? "nt" : ""} ${formatCurrency(workspace.signals.pipelineValueCents)}. Une revue humaine des prochaines actions peut réduire la valeur laissée sans suivi.`,
      expectedGain:
        "Augmenter la part du pipeline disposant d'une prochaine action claire et datée.",
      effort: "low",
      roiSummary:
        "ROI potentiellement élevé si la revue évite la perte d'une opportunité déjà qualifiée.",
      riskSummary:
        "Risque faible ; aucune prise de contact n'est envoyée automatiquement.",
      confidence: 95,
      actionLabel: "Revoir les opportunités",
      actionHref: "/opportunites",
      evidence: [
        {
          type: "system_metric",
          ref: "crm.active_opportunities",
          label: "Opportunités actives",
          observedValue: String(workspace.signals.opportunities),
        },
        {
          type: "system_metric",
          ref: "crm.pipeline_value_cents",
          label: "Valeur du pipeline",
          observedValue: formatCurrency(workspace.signals.pipelineValueCents),
        },
      ],
    });
  }

  if (
    workspace.signals.contacts > 0 &&
    workspace.signals.activeWorkflows === 0
  ) {
    candidates.push({
      ruleKey: "operations.contact_follow_up_coverage",
      role: "operations",
      title: "Évaluer une relance structurée des contacts",
      rationale: `${workspace.signals.contacts} contact${workspace.signals.contacts > 1 ? "s sont" : " est"} enregistré${workspace.signals.contacts > 1 ? "s" : ""}, sans automatisation active détectée. Une proposition de suivi peut être préparée puis soumise à approbation.`,
      expectedGain:
        "Réduire les oublis de suivi sans autoriser d'envoi automatique non approuvé.",
      effort: "medium",
      roiSummary:
        "ROI à mesurer par le temps économisé et le nombre de suivis réalisés dans les délais.",
      riskSummary:
        "Risque moyen lié au consentement et à la fréquence ; chaque canal doit rester approuvé.",
      confidence: 90,
      actionLabel: "Examiner les automatisations",
      actionHref: "/automatisations",
      evidence: [
        {
          type: "system_metric",
          ref: "crm.contacts",
          label: "Contacts actifs",
          observedValue: String(workspace.signals.contacts),
        },
        {
          type: "system_metric",
          ref: "workflow.active",
          label: "Automatisations actives",
          observedValue: "0",
        },
      ],
    });
  }

  if (
    workspace.signals.websites > 0 &&
    workspace.signals.publishedWebsites === 0
  ) {
    candidates.push({
      ruleKey: "marketing.website_publication_review",
      role: "marketing",
      title: "Préparer la revue du site avant publication",
      rationale:
        "Un site existe mais aucune version publiée n'est détectée. La publication doit rester une décision humaine après vérification du contenu, des coordonnées et des formulaires.",
      expectedGain:
        "Rendre la présence numérique exploitable tout en conservant une validation éditoriale.",
      effort: "low",
      roiSummary:
        "ROI potentiel rapide après publication si le site génère des demandes qualifiées.",
      riskSummary:
        "Risque moyen en cas de contenu ou de coordonnées non vérifiés ; aucune publication automatique.",
      confidence: 100,
      actionLabel: "Vérifier le site",
      actionHref: "/mon-site",
      evidence: [
        {
          type: "system_metric",
          ref: "website.total",
          label: "Sites configurés",
          observedValue: String(workspace.signals.websites),
        },
        {
          type: "system_metric",
          ref: "website.published",
          label: "Sites publiés",
          observedValue: "0",
        },
      ],
    });
  }

  if (workspace.signals.apiAssets > 0) {
    candidates.push({
      ruleKey: "technology.api_governance_review",
      role: "technology",
      title: "Revoir les actifs API avant toute activation",
      rationale: `${workspace.signals.apiAssets} actif${workspace.signals.apiAssets > 1 ? "s API sont" : " API est"} associé${workspace.signals.apiAssets > 1 ? "s" : ""} à l'organisation. Les preuves, contrats et approbations doivent rester valides avant toute utilisation.`,
      expectedGain:
        "Limiter les incompatibilités et les activations fondées sur une documentation obsolète.",
      effort: "medium",
      roiSummary:
        "ROI défensif : réduction du coût des incidents et des réparations de connecteur.",
      riskSummary:
        "Risque technique élevé sans revue ; cette recommandation n'active aucun connecteur.",
      confidence: 95,
      actionLabel: "Examiner les connexions",
      actionHref: "/connexions",
      evidence: [
        {
          type: "system_metric",
          ref: "api.tenant_assets",
          label: "Actifs API tenant",
          observedValue: String(workspace.signals.apiAssets),
        },
      ],
    });
  }

  return candidates.slice(0, 8).map((candidate) => ({
    ...candidate,
    fingerprint: hashToken(
      toJson({
        generationVersion: strategicAdvisorGenerationVersion,
        ruleKey: candidate.ruleKey,
        evidence: candidate.evidence,
      }),
    ),
  }));
}

function formatCurrency(valueCents: number) {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
    maximumFractionDigits: 0,
  }).format(valueCents / 100);
}
