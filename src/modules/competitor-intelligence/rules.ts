import { hashToken, toJson } from "@/lib/security";
import type { CompetitorObservationRow } from "@/modules/competitor-intelligence/repository";
import type {
  CompetitorCategory,
  CompetitorDirection,
} from "@/modules/competitor-intelligence/schemas";

export type CompetitorImpact = "opportunity" | "risk" | "watch";
export type CompetitorEvidenceCandidate = {
  observationId: string;
  label: string;
  observedValue: string;
};

export const competitorGenerationVersion = "deterministic-public-observation-v1";

export function buildCompetitorInsightCandidate(input: {
  competitorName: string;
  latest: CompetitorObservationRow;
  previous?: CompetitorObservationRow;
}) {
  const impact = classifyImpact(input.latest.category, input.latest.direction);
  const confidence = input.previous ? 90 : 70;
  const category = categoryLabel(input.latest.category);
  const title = truncate(
    `${impactLabel(impact)} : ${input.competitorName} · ${category}`,
    180,
  );
  const rationale = input.previous
    ? `Deux observations publiques enregistrées permettent de comparer ${category.toLowerCase()}. La dernière direction déclarée est « ${directionLabel(input.latest.direction)} ». Cette lecture ne résulte d'aucune collecte automatique.`
    : `Une première observation publique établit un point de référence pour ${category.toLowerCase()}. Une seconde preuve sera nécessaire avant de conclure à une tendance.`;
  const evidence: CompetitorEvidenceCandidate[] = [
    {
      observationId: input.latest.id,
      label: "Observation publique récente",
      observedValue: `${directionLabel(input.latest.direction)} · ${formatDate(input.latest.observed_at)}`,
    },
  ];
  if (input.previous) {
    evidence.push({
      observationId: input.previous.id,
      label: "Observation publique précédente",
      observedValue: `${directionLabel(input.previous.direction)} · ${formatDate(input.previous.observed_at)}`,
    });
  }
  return {
    competitorId: input.latest.competitor_id,
    category: input.latest.category,
    latestObservationId: input.latest.id,
    previousObservationId: input.previous?.id,
    fingerprint: hashToken(
      toJson({
        latestHash: input.latest.content_hash,
        previousHash: input.previous?.content_hash ?? null,
        generationVersion: competitorGenerationVersion,
      }),
    ),
    impact,
    confidence,
    title,
    rationale,
    recommendedAction: recommendedAction(input.latest.category, impact, Boolean(input.previous)),
    evidence,
  };
}

export type CompetitorInsightCandidate = ReturnType<
  typeof buildCompetitorInsightCandidate
>;

function classifyImpact(
  category: CompetitorCategory,
  direction: CompetitorDirection,
): CompetitorImpact {
  if (direction === "negative_signal" || direction === "removed") {
    return "opportunity";
  }
  if (direction === "positive_signal") return "risk";
  if (category === "price" && direction === "increase") return "opportunity";
  if (category === "price" && direction === "decrease") return "risk";
  if (
    ["service", "product", "advertising", "seo", "google_position"].includes(category) &&
    direction === "new"
  ) {
    return "risk";
  }
  return "watch";
}

function recommendedAction(
  category: CompetitorCategory,
  impact: CompetitorImpact,
  compared: boolean,
) {
  if (!compared) {
    return "Enregistrer une seconde observation publique indépendante avant de modifier une offre, un prix ou une campagne.";
  }
  if (category === "price") {
    return "Comparer les offres et la valeur délivrée avec les données internes, puis préparer une décision tarifaire humaine sans modifier automatiquement les prix.";
  }
  if (category === "review") {
    return "Examiner les thèmes du retour public et vérifier les pratiques internes, sans contacter le concurrent ni intervenir sur sa réputation.";
  }
  if (impact === "risk") {
    return "Évaluer l'écart avec l'offre actuelle, chiffrer l'impact possible et soumettre une réponse interne à validation.";
  }
  if (impact === "opportunity") {
    return "Vérifier la demande client et préparer une option interne qui exploite l'écart observé sans action externe automatique.";
  }
  return "Maintenir la veille manuelle et attendre une nouvelle preuve publique avant toute décision opérationnelle.";
}

function categoryLabel(category: CompetitorCategory) {
  const labels: Record<CompetitorCategory, string> = {
    price: "Prix",
    website: "Site web",
    seo: "Référencement",
    service: "Service",
    product: "Produit",
    google_position: "Position Google",
    advertising: "Publicité",
    social_activity: "Activité sociale",
    review: "Avis publics",
    opening_hours: "Horaires",
    job: "Recrutement",
    partnership: "Partenariat",
  };
  return labels[category];
}

function directionLabel(direction: CompetitorDirection) {
  const labels: Record<CompetitorDirection, string> = {
    increase: "hausse",
    decrease: "baisse",
    new: "nouveauté",
    removed: "retrait",
    changed: "changement",
    positive_signal: "signal positif",
    negative_signal: "signal négatif",
  };
  return labels[direction];
}

function impactLabel(impact: CompetitorImpact) {
  return impact === "opportunity"
    ? "Opportunité à vérifier"
    : impact === "risk"
      ? "Risque à examiner"
      : "Évolution à surveiller";
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("fr-FR", { dateStyle: "medium" }).format(
    new Date(value),
  );
}

function truncate(value: string, max: number) {
  return value.length <= max ? value : `${value.slice(0, max - 1)}…`;
}
