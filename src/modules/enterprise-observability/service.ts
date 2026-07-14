import type { DbClient } from "@/lib/db";
import {
  readTenantOperationalSignals,
  type OperationalSignals,
} from "@/modules/enterprise-observability/repository";
import {
  enterpriseObservabilityInputSchema,
  type EnterpriseObservabilityInput,
  type OperationalHealthStatus,
} from "@/modules/enterprise-observability/schemas";
import { assertTenantAccess } from "@/modules/tenants";

type OperationalDetail = {
  label: string;
  value: number | string;
};

export type OperationalHealthMetric = {
  key: string;
  title: string;
  status: OperationalHealthStatus;
  summary: string;
  details: OperationalDetail[];
  action: { label: string; href: string } | null;
  measured: boolean;
};

const dayMs = 24 * 60 * 60 * 1_000;
const staleProcessingMs = 15 * 60 * 1_000;

export async function getEnterpriseObservability(
  db: DbClient,
  userId: string,
  tenantId: string,
  input: EnterpriseObservabilityInput = {},
) {
  await assertTenantAccess(db, userId, tenantId);
  const parsed = enterpriseObservabilityInputSchema.parse(input);
  const now = parsed.now ?? new Date();
  const signals = await readTenantOperationalSignals(db, tenantId, {
    now: now.toISOString(),
    recentSince: new Date(now.getTime() - dayMs).toISOString(),
    staleSince: new Date(now.getTime() - staleProcessingMs).toISOString(),
  });
  const metrics = buildMetrics(signals);

  return {
    capturedAt: now.toISOString(),
    scope: "tenant" as const,
    overview: {
      measured: metrics.filter((metric) => metric.measured).length,
      healthy: countStatus(metrics, "healthy"),
      attention: countStatus(metrics, "attention"),
      critical: countStatus(metrics, "critical"),
      unavailable: countStatus(metrics, "unavailable"),
    },
    metrics,
  };
}

function buildMetrics(signals: OperationalSignals): OperationalHealthMetric[] {
  return [
    measuredMetric({
      key: "database",
      title: "Base de données",
      status: "healthy",
      summary: "La lecture de la base limitée à cette organisation a abouti.",
      details: [{ label: "Périmètre", value: "Organisation active" }],
    }),
    unavailableMetric(
      "workers",
      "Agents de traitement",
      "Aucun signal de présence fiable des agents n'est encore collecté.",
    ),
    measuredMetric({
      key: "queues",
      title: "Files de travail",
      status:
        signals.queueFailed > 0 || signals.queueStale > 0
          ? "critical"
          : signals.queueDue > 0
            ? "attention"
            : "healthy",
      summary:
        signals.queueFailed > 0 || signals.queueStale > 0
          ? "Des événements nécessitent une reprise contrôlée."
          : signals.queueDue > 0
            ? "Des événements sont prêts à être traités."
            : "Aucun événement en retard ou en échec n'est détecté.",
      details: [
        { label: "Prêts", value: signals.queueDue },
        { label: "Planifiés", value: signals.queueScheduled },
        { label: "En traitement", value: signals.queueProcessing },
        { label: "Traitements figés", value: signals.queueStale },
        { label: "Échecs terminaux", value: signals.queueFailed },
      ],
      action: { label: "Examiner les automatisations", href: "/automatisations" },
    }),
    measuredMetric({
      key: "workflows",
      title: "Automatisations",
      status:
        signals.workflowFailed > 0
          ? "critical"
          : signals.workflowWaiting > 0
            ? "attention"
            : "healthy",
      summary:
        signals.workflowFailed > 0
          ? "Au moins une exécution est en échec."
          : signals.workflowWaiting > 0
            ? "Des exécutions attendent une décision ou une reprise."
            : "Aucune exécution en échec ou en attente n'est détectée.",
      details: [
        { label: "En échec", value: signals.workflowFailed },
        { label: "En attente", value: signals.workflowWaiting },
      ],
      action: { label: "Ouvrir les automatisations", href: "/automatisations" },
    }),
    unavailableMetric(
      "ai",
      "IA externe",
      "Aucune télémétrie de fournisseur IA externe n'est disponible.",
    ),
    measuredMetric({
      key: "email",
      title: "File e-mail interne",
      status:
        signals.emailDispatchFailures24h > 0
          ? "critical"
          : signals.emailQueued > 0
            ? "attention"
            : "healthy",
      summary:
        signals.emailDispatchFailures24h > 0
          ? "Des demandes d'envoi interne ont échoué sur les dernières 24 heures."
          : signals.emailQueued > 0
            ? "Des e-mails internes attendent leur traitement."
            : "Aucun e-mail interne n'attend son traitement.",
      details: [
        { label: "En attente", value: signals.emailQueued },
        { label: "Marqués envoyés sur 24 h", value: signals.emailSent24h },
        { label: "Échecs de traitement sur 24 h", value: signals.emailDispatchFailures24h },
      ],
      action: { label: "Voir les résultats", href: "/resultats" },
    }),
    unavailableMetric(
      "sms",
      "SMS",
      "Aucun fournisseur SMS de production n'est activé ni instrumenté.",
    ),
    unavailableMetric(
      "whatsapp",
      "WhatsApp",
      "Aucun fournisseur WhatsApp de production n'est activé ni instrumenté.",
    ),
    measuredMetric({
      key: "api",
      title: "Intelligence API",
      status:
        signals.apiBlocked > 0 ||
        signals.apiFailedContracts24h > 0 ||
        signals.apiBlockedImpacts > 0
          ? "critical"
          : signals.apiRetrying > 0 || signals.apiDue > 0
            ? "attention"
            : "healthy",
      summary:
        signals.apiBlocked > 0 ||
        signals.apiFailedContracts24h > 0 ||
        signals.apiBlockedImpacts > 0
          ? "Des sources ou contrats API de cette organisation nécessitent une revue."
          : signals.apiRetrying > 0 || signals.apiDue > 0
            ? "Des vérifications API sont dues ou en reprise."
            : "Aucun blocage API n'est détecté pour cette organisation.",
      details: [
        { label: "Sources bloquées", value: signals.apiBlocked },
        { label: "Sources en reprise", value: signals.apiRetrying },
        { label: "Vérifications dues", value: signals.apiDue },
        { label: "Contrats échoués sur 24 h", value: signals.apiFailedContracts24h },
        { label: "Mises à niveau bloquées", value: signals.apiBlockedImpacts },
      ],
      action: { label: "Examiner les connexions", href: "/connexions" },
    }),
    measuredMetric({
      key: "connectors",
      title: "Connecteurs",
      status:
        signals.connectorErrors > 0 || signals.connectorSyncFailures24h > 0
          ? "critical"
          : signals.connectorWarnings > 0
            ? "attention"
            : "healthy",
      summary:
        signals.connectorErrors > 0 || signals.connectorSyncFailures24h > 0
          ? "Des connecteurs ou synchronisations sont en échec."
          : signals.connectorWarnings > 0
            ? "Des connecteurs demandent une vérification."
            : "Aucun problème de connecteur n'est détecté.",
      details: [
        { label: "En erreur", value: signals.connectorErrors },
        { label: "En avertissement", value: signals.connectorWarnings },
        { label: "Synchronisations échouées sur 24 h", value: signals.connectorSyncFailures24h },
      ],
      action: { label: "Ouvrir les connexions", href: "/connexions" },
    }),
    unavailableMetric(
      "cpu",
      "Processeur",
      "Aucune métrique CPU de l'environnement d'hébergement n'est collectée.",
    ),
    unavailableMetric(
      "memory",
      "Mémoire",
      "Aucune métrique mémoire de l'environnement d'hébergement n'est collectée.",
    ),
    unavailableMetric(
      "storage",
      "Stockage",
      "Aucune métrique de capacité du stockage n'est collectée.",
    ),
    measuredMetric({
      key: "security",
      title: "Signaux de sécurité applicatifs",
      status: signals.webhookRejections24h > 0 ? "attention" : "healthy",
      summary:
        signals.webhookRejections24h > 0
          ? "Des livraisons webhook ont été refusées sur les dernières 24 heures."
          : "Aucun refus webhook récent n'est détecté pour cette organisation.",
      details: [
        { label: "Webhooks refusés sur 24 h", value: signals.webhookRejections24h },
        { label: "Points d'entrée désactivés", value: signals.webhookDisabled },
      ],
      action: { label: "Vérifier les connexions", href: "/connexions" },
    }),
    unavailableMetric(
      "cost",
      "Coûts fournisseurs",
      "Aucune donnée de facturation fournisseur fiable n'est collectée.",
    ),
  ];
}

function measuredMetric(
  metric: Omit<OperationalHealthMetric, "measured" | "action"> & {
    action?: OperationalHealthMetric["action"];
  },
): OperationalHealthMetric {
  return { ...metric, action: metric.action ?? null, measured: true };
}

function unavailableMetric(
  key: string,
  title: string,
  summary: string,
): OperationalHealthMetric {
  return {
    key,
    title,
    status: "unavailable",
    summary,
    details: [{ label: "État", value: "Non instrumenté" }],
    action: null,
    measured: false,
  };
}

function countStatus(
  metrics: OperationalHealthMetric[],
  status: OperationalHealthStatus,
) {
  return metrics.filter((metric) => metric.status === status).length;
}
