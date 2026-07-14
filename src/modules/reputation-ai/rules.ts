import { hashToken, toJson } from "@/lib/security";
import type {
  ReputationReviewRow,
} from "@/modules/reputation-ai/repository";

export type ReputationSentiment = "positive" | "neutral" | "negative";
export type ReputationRiskLevel = "low" | "medium" | "high";
export type ReputationEvidenceCandidate = {
  type: "review_source" | "review_rating" | "review_text";
  ref: string;
  label: string;
  observedValue: string;
};

export const reputationGenerationVersion = "deterministic-fr-lexicon-v1";

const positiveWords = [
  "excellent",
  "merci",
  "rapide",
  "recommande",
  "satisfait",
  "parfait",
  "professionnel",
  "accueil",
];
const negativeWords = [
  "mauvais",
  "decu",
  "déçu",
  "retard",
  "cher",
  "probleme",
  "problème",
  "jamais",
  "panne",
  "attente",
  "insatisfait",
];

export function buildReputationProposalCandidate(review: ReputationReviewRow) {
  const normalized = review.review_text.toLocaleLowerCase("fr-FR");
  const positiveCount = positiveWords.filter((word) => normalized.includes(word)).length;
  const negativeCount = negativeWords.filter((word) => normalized.includes(word)).length;
  let sentiment: ReputationSentiment = "neutral";
  if ((review.rating ?? 0) >= 4 || positiveCount > negativeCount) sentiment = "positive";
  if ((review.rating ?? 3) <= 2 || negativeCount > positiveCount) sentiment = "negative";
  const lexicalSignals = positiveCount + negativeCount;
  const confidence = Math.min(95, 55 + (review.rating ? 20 : 0) + Math.min(20, lexicalSignals * 5));
  const riskLevel: ReputationRiskLevel =
    sentiment === "negative" && (review.rating === 1 || negativeCount >= 2)
      ? "high"
      : sentiment === "negative"
        ? "medium"
        : "low";
  const responseDraft = responseFor(sentiment);
  const improvementPlan = improvementFor(normalized, sentiment);
  const evidence: ReputationEvidenceCandidate[] = [
    {
      type: "review_source",
      ref: review.id,
      label: "Source déclarée",
      observedValue: review.source,
    },
    {
      type: "review_text",
      ref: review.id,
      label: "Texte analysé",
      observedValue: `${review.review_text.length} caractère(s), ${positiveCount} signal(aux) positif(s), ${negativeCount} négatif(s)`,
    },
  ];
  if (review.rating) {
    evidence.push({
      type: "review_rating",
      ref: review.id,
      label: "Note déclarée",
      observedValue: `${review.rating}/5`,
    });
  }
  return {
    reviewId: review.id,
    fingerprint: hashToken(
      toJson({
        reviewId: review.id,
        contentHash: review.content_hash,
        generationVersion: reputationGenerationVersion,
      }),
    ),
    sentiment,
    confidence,
    riskLevel,
    authenticityStatus: "not_assessed" as const,
    rationale: `Le classement utilise la note déclarée et ${lexicalSignals} signal(aux) lexical(aux) français. Il ne vérifie ni l'auteur ni l'authenticité de l'avis.`,
    responseDraft,
    improvementPlan,
    evidence,
  };
}

function responseFor(sentiment: ReputationSentiment) {
  if (sentiment === "positive") {
    return "Merci d'avoir partagé votre retour. Nous sommes heureux que votre expérience ait été positive et transmettons vos encouragements à l'équipe.";
  }
  if (sentiment === "negative") {
    return "Merci d'avoir pris le temps de partager votre expérience. Nous sommes désolés qu'elle n'ait pas répondu à vos attentes. Nous vous invitons à nous contacter directement afin d'examiner la situation avec les éléments nécessaires.";
  }
  return "Merci pour votre retour. Nous prenons en compte vos remarques et les transmettons à l'équipe afin d'améliorer continuellement notre service.";
}

function improvementFor(text: string, sentiment: ReputationSentiment) {
  if (text.includes("retard") || text.includes("attente")) {
    return "Vérifier les délais annoncés, identifier l'étape ayant créé l'attente et définir un point d'information client avant le prochain engagement.";
  }
  if (text.includes("cher") || text.includes("prix")) {
    return "Revoir la clarté du devis, des options et des écarts de prix avant validation, sans modifier automatiquement la tarification.";
  }
  if (sentiment === "negative") {
    return "Qualifier le problème avec l'équipe concernée, documenter la cause et suivre une action corrective interne avant toute réponse publique.";
  }
  return "Partager le retour avec l'équipe et conserver les pratiques citées positivement dans les prochains contrôles qualité.";
}
