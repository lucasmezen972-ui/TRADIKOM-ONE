import { safeJson } from "@/lib/security";
import type {
  ConnectorSignalRow,
  SelfImprovementCategory,
  WebsiteHeroSignalRow,
  WebsitePageSignalRow,
  WorkflowSignalRow,
} from "@/modules/self-improvement/repository";

export type SelfImprovementEvidenceCandidate = {
  key: string;
  sourceType: string;
  sourceId: string;
  metricName: string;
  metricValue: number;
  summary: string;
};

export type SelfImprovementCandidate = {
  proposalKey: string;
  category: SelfImprovementCategory;
  entityType: string;
  entityId: string;
  title: string;
  explanation: string;
  recommendation: string;
  actionLabel: string;
  actionHref: string;
  severity: "critical" | "warning" | "info";
  confidence: number;
  evidence: SelfImprovementEvidenceCandidate[];
};

export type SelfImprovementSignalSnapshot = {
  workflows: WorkflowSignalRow[];
  connectors: ConnectorSignalRow[];
  duplicateContactPairs: number;
  websitePages: WebsitePageSignalRow[];
  websiteHeroes: WebsiteHeroSignalRow[];
};

export function buildSelfImprovementCandidates(
  snapshot: SelfImprovementSignalSnapshot,
  now: Date,
) {
  const staleCutoff = new Date(
    now.getTime() - 30 * 24 * 60 * 60 * 1_000,
  ).getTime();
  const candidates: SelfImprovementCandidate[] = [];

  for (const workflow of snapshot.workflows) {
    const runCount = Number(workflow.run_count);
    const failedCount = Number(workflow.failed_count);
    if (failedCount > 0) {
      candidates.push({
        proposalKey: `workflow-failed:${workflow.id}`,
        category: "workflow_failed",
        entityType: "workflow",
        entityId: workflow.id,
        title: `Fiabiliser ${workflow.name}`,
        explanation: `${failedCount} exécution(s) de ce workflow sont en échec terminal.`,
        recommendation:
          "Examiner la chronologie et les lettres mortes, corriger la cause puis lancer uniquement une reprise manuelle validée.",
        actionLabel: "Examiner le workflow",
        actionHref: "/automatisations",
        severity: "critical",
        confidence: 100,
        evidence: [{
          key: "failed-runs",
          sourceType: "workflow_runs",
          sourceId: workflow.id,
          metricName: "failed_run_count",
          metricValue: failedCount,
          summary: `${failedCount} exécution(s) terminale(s) en échec sont enregistrées.`,
        }],
      });
    }
    if (runCount === 0 && Date.parse(workflow.created_at) <= staleCutoff) {
      candidates.push({
        proposalKey: `workflow-unused:${workflow.id}`,
        category: "workflow_unused",
        entityType: "workflow",
        entityId: workflow.id,
        title: `Revoir l'automatisation ${workflow.name}`,
        explanation:
          "Ce workflow actif n'a produit aucune exécution depuis au moins trente jours.",
        recommendation:
          "Vérifier son déclencheur et son utilité, puis le conserver, le corriger ou le mettre en pause après revue humaine.",
        actionLabel: "Ouvrir les automatisations",
        actionHref: "/automatisations",
        severity: "info",
        confidence: 95,
        evidence: [{
          key: "run-count",
          sourceType: "workflows",
          sourceId: workflow.id,
          metricName: "run_count",
          metricValue: 0,
          summary: "Aucune exécution n'est enregistrée pour ce workflow actif.",
        }],
      });
    }
  }

  for (const connector of snapshot.connectors) {
    if (["warning", "error"].includes(connector.health)) {
      candidates.push({
        proposalKey: `connector-degraded:${connector.id}`,
        category: "connector_degraded",
        entityType: "connector",
        entityId: connector.id,
        title: `Vérifier le connecteur ${connector.connector_key}`,
        explanation:
          connector.health === "error"
            ? "Le connecteur signale un état d'erreur."
            : "Le connecteur signale un état dégradé.",
        recommendation:
          "Examiner sa santé et ses derniers contrôles avant toute future activation ou synchronisation.",
        actionLabel: "Ouvrir les connexions",
        actionHref: "/connexions",
        severity: connector.health === "error" ? "critical" : "warning",
        confidence: 100,
        evidence: [{
          key: "health-state",
          sourceType: "connectors",
          sourceId: connector.id,
          metricName: "degraded_health",
          metricValue: 1,
          summary: "Un état de santé dégradé est enregistré pour ce connecteur.",
        }],
      });
    }
    const lastUse = connector.last_sync_at
      ? Date.parse(connector.last_sync_at)
      : Date.parse(connector.created_at);
    if (connector.status === "Connecté" && lastUse <= staleCutoff) {
      candidates.push({
        proposalKey: `connector-unused:${connector.id}`,
        category: "connector_unused",
        entityType: "connector",
        entityId: connector.id,
        title: `Revoir l'usage du connecteur ${connector.connector_key}`,
        explanation:
          "Ce connecteur déclaré connecté n'a pas été synchronisé depuis au moins trente jours.",
        recommendation:
          "Vérifier le besoin et la configuration, puis décider humainement de le conserver ou de le désactiver.",
        actionLabel: "Ouvrir les connexions",
        actionHref: "/connexions",
        severity: "info",
        confidence: 95,
        evidence: [{
          key: "recent-sync-count",
          sourceType: "connector_sync_runs",
          sourceId: connector.id,
          metricName: "syncs_last_30_days",
          metricValue: 0,
          summary: "Aucune synchronisation récente n'est enregistrée.",
        }],
      });
    }
  }

  if (snapshot.duplicateContactPairs > 0) {
    candidates.push({
      proposalKey: "contact-duplicates:tenant",
      category: "contact_duplicates",
      entityType: "tenant",
      entityId: "contacts",
      title: "Examiner les doublons CRM",
      explanation: `${snapshot.duplicateContactPairs} paire(s) de contacts présentent un email ou téléphone normalisé identique.`,
      recommendation:
        "Comparer les fiches proposées et utiliser la fusion CRM transactionnelle uniquement après validation des champs à conserver.",
      actionLabel: "Examiner les doublons",
      actionHref: "/contacts/doublons",
      severity: "warning",
      confidence: 90,
      evidence: [{
        key: "duplicate-pairs",
        sourceType: "contacts",
        sourceId: "tenant",
        metricName: "duplicate_pair_count",
        metricValue: snapshot.duplicateContactPairs,
        summary: `${snapshot.duplicateContactPairs} paire(s) potentiellement dupliquée(s) ont été détectées.`,
      }],
    });
  }

  for (const page of snapshot.websitePages) {
    const metadata = safeJson<Record<string, unknown>>(page.seo_metadata, {});
    const title = typeof metadata.title === "string" ? metadata.title.trim() : "";
    const description =
      typeof metadata.description === "string" ? metadata.description.trim() : "";
    const missingCount = Number(title.length < 10) + Number(description.length < 50);
    if (missingCount > 0) {
      candidates.push({
        proposalKey: `seo-metadata:${page.id}`,
        category: "seo_metadata",
        entityType: "website_page",
        entityId: page.id,
        title: "Compléter les métadonnées SEO",
        explanation: `${missingCount} champ(s) SEO de la page ${page.title} sont absents ou trop courts.`,
        recommendation:
          "Préparer un titre précis et une description factuelle à partir du Business Twin, puis les faire relire avant publication.",
        actionLabel: "Ouvrir le site",
        actionHref: "/mon-site",
        severity: "warning",
        confidence: 90,
        evidence: [{
          key: "seo-required-fields",
          sourceType: "website_pages",
          sourceId: page.id,
          metricName: "incomplete_seo_fields",
          metricValue: missingCount,
          summary: `${missingCount} champ(s) SEO obligatoire(s) nécessitent une revue.`,
        }],
      });
    }
  }

  for (const hero of snapshot.websiteHeroes) {
    const missingCount = Number(!hero.button_label?.trim()) + Number(!hero.button_href?.trim());
    if (missingCount > 0) {
      candidates.push({
        proposalKey: `website-cta:${hero.id}`,
        category: "website_cta",
        entityType: "website_section",
        entityId: hero.id,
        title: "Clarifier l'action principale du site",
        explanation:
          "La section d'ouverture visible ne dispose pas d'un libellé et d'une destination d'action complets.",
        recommendation:
          "Préparer un appel à l'action cohérent avec l'objectif du Business Twin et le valider dans le brouillon du site.",
        actionLabel: "Ouvrir le brouillon",
        actionHref: "/mon-site",
        severity: "warning",
        confidence: 95,
        evidence: [{
          key: "hero-action-fields",
          sourceType: "website_sections",
          sourceId: hero.id,
          metricName: "missing_action_fields",
          metricValue: missingCount,
          summary: `${missingCount} champ(s) d'action visible(s) sont incomplets.`,
        }],
      });
    }
  }

  const severityOrder = { critical: 0, warning: 1, info: 2 } as const;
  return candidates
    .sort((left, right) =>
      severityOrder[left.severity] - severityOrder[right.severity]
      || left.proposalKey.localeCompare(right.proposalKey),
    )
    .slice(0, 100);
}

export const selfImprovementCoverage = [
  { key: "workflow_health", label: "Workflows en échec", status: "measured" },
  { key: "workflow_usage", label: "Automatisations inutilisées", status: "measured" },
  { key: "connector_health", label: "Connecteurs dégradés", status: "measured" },
  { key: "connector_usage", label: "Connecteurs inutilisés", status: "measured" },
  { key: "contact_duplicates", label: "Doublons CRM", status: "measured" },
  { key: "seo_metadata", label: "Métadonnées SEO", status: "measured" },
  { key: "website_cta", label: "Action principale du site", status: "measured" },
  { key: "slow_pages", label: "Pages lentes", status: "unavailable" },
  { key: "unused_pages", label: "Pages inutilisées", status: "unavailable" },
  { key: "unused_fields", label: "Champs inutilisés", status: "unavailable" },
  { key: "low_conversion", label: "Faible conversion", status: "unavailable" },
] as const;
