import { hashToken, toJson } from "@/lib/security";
import type { BusinessProfile } from "@/lib/types";
import type { MarketingChannel } from "@/modules/autonomous-marketing/schemas";

export type MarketingEvidenceCandidate = {
  type: "business_profile" | "business_brain_entry" | "strategic_recommendation";
  ref: string;
  label: string;
  observedValue: string;
};

export type MarketingProposalCandidate = {
  campaignKey: string;
  fingerprint: string;
  channel: MarketingChannel;
  title: string;
  subject: string;
  objective: string;
  audience: string;
  content: string;
  callToAction: string;
  expectedOutcome: string;
  riskSummary: string;
  evidence: MarketingEvidenceCandidate[];
};

export const autonomousMarketingGenerationVersion = "deterministic-marketing-v1";

export function buildMarketingProposalCandidates(
  tenantId: string,
  profile: BusinessProfile,
): MarketingProposalCandidate[] {
  const company = profile.identity.companyName;
  const offer = profile.services[0] ?? profile.products[0] ?? profile.identity.category;
  const audience = profile.targetCustomers;
  const callToAction =
    profile.websitePreferences.desiredCallsToAction[0] ?? "Nous contacter";
  const objective = profile.salesObjectives;
  const sharedEvidence: MarketingEvidenceCandidate[] = [
    {
      type: "business_profile",
      ref: tenantId,
      label: "Identité vérifiée",
      observedValue: `${company} — ${profile.identity.category}`,
    },
    {
      type: "business_profile",
      ref: `${tenantId}:audience`,
      label: "Public cible vérifié",
      observedValue: audience,
    },
    {
      type: "business_profile",
      ref: `${tenantId}:offer`,
      label: "Offre vérifiée",
      observedValue: offer,
    },
  ];

  const candidates: Array<Omit<MarketingProposalCandidate, "fingerprint">> = [
    {
      campaignKey: "business-twin-email-introduction",
      channel: "email",
      title: `Présentation de ${offer}`,
      subject: `${company} : découvrez ${offer}`,
      objective,
      audience,
      content: `Bonjour,\n\n${company} vous présente ${offer}. ${profile.identity.description}\n\n${callToAction} pour obtenir les informations adaptées à votre besoin.`,
      callToAction,
      expectedOutcome:
        "Obtenir des demandes qualifiées sans promettre de résultat ni déclencher d'envoi automatique.",
      riskSummary:
        "Vérifier le consentement, la liste de destinataires et les coordonnées avant tout envoi manuel.",
      evidence: sharedEvidence,
    },
    {
      campaignKey: "business-twin-social-introduction",
      channel: "social",
      title: `Publication de présentation : ${offer}`,
      subject: "",
      objective,
      audience,
      content: `${company} accompagne ${audience} autour de ${offer}. ${profile.identity.description} ${callToAction} pour en savoir plus.`,
      callToAction,
      expectedOutcome:
        "Présenter l'offre avec un message factuel et mesurer les prises de contact après publication manuelle.",
      riskSummary:
        "Relire le ton, les mentions et le canal avant publication ; aucun résultat commercial n'est garanti.",
      evidence: sharedEvidence,
    },
  ];

  return candidates.map((candidate) => ({
    ...candidate,
    fingerprint: hashToken(
      toJson({
        generationVersion: autonomousMarketingGenerationVersion,
        campaignKey: candidate.campaignKey,
        channel: candidate.channel,
        content: candidate.content,
        evidence: candidate.evidence,
      }),
    ),
  }));
}

export function fingerprintMarketingRevision(input: {
  campaignKey: string;
  version: number;
  title: string;
  subject: string;
  objective: string;
  audience: string;
  content: string;
  callToAction: string;
  expectedOutcome: string;
  riskSummary: string;
}) {
  return hashToken(
    toJson({
      generationVersion: autonomousMarketingGenerationVersion,
      ...input,
    }),
  );
}
