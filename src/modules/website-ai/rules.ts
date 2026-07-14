import { hashToken, toJson } from "@/lib/security";
import type { BusinessProfile, Website, WebsiteSection } from "@/lib/types";

export type WebsiteAiEvidenceCandidate = {
  type: "business_profile" | "website_section";
  ref: string;
  label: string;
  observedValue: string;
};

export type WebsiteAiProposalCandidate = {
  websiteId: string;
  sectionId: string;
  proposalKey: string;
  fingerprint: string;
  proposalType: "seo_copy" | "faq_content" | "accessibility_copy";
  title: string;
  rationale: string;
  expectedGain: string;
  riskSummary: string;
  proposedTitle: string;
  proposedBody: string;
  originalContentHash: string;
  evidence: WebsiteAiEvidenceCandidate[];
};

export const websiteAiGenerationVersion = "deterministic-website-ai-v1";

export function buildWebsiteAiProposalCandidates(input: {
  profile: BusinessProfile;
  website: Website;
  sections: WebsiteSection[];
}) {
  const candidates: Array<Omit<WebsiteAiProposalCandidate, "fingerprint">> = [];
  const hero = input.sections.find((section) => section.type === "hero");
  const offer =
    input.profile.services[0] ??
    input.profile.products[0] ??
    input.profile.identity.category;

  if (hero) {
    const proposedTitle = `${input.profile.identity.companyName} — ${offer}`;
    const area = input.profile.geographicalAreas[0];
    const proposedBody = area
      ? `${input.profile.identity.description} Service disponible à ${area}.`
      : input.profile.identity.description;
    candidates.push({
      websiteId: input.website.id,
      sectionId: hero.id,
      proposalKey: `hero-seo-copy:${hero.id}`,
      proposalType: "seo_copy",
      title: "Clarifier la promesse de la page d'accueil",
      rationale:
        "Le titre proposé associe l'entreprise à une offre enregistrée et le texte reprend uniquement la description et la zone vérifiées dans le Business Twin.",
      expectedGain:
        "Faciliter la compréhension de l'offre principale sans inventer de résultat ni de certification.",
      riskSummary:
        "Une relecture humaine reste nécessaire avant toute publication ; l'application ne modifie que le brouillon.",
      proposedTitle,
      proposedBody,
      originalContentHash: hashWebsiteSectionContent(hero),
      evidence: [
        profileEvidence(
          input.website.tenantId,
          "Offre enregistrée",
          offer,
          "offer",
        ),
        profileEvidence(
          input.website.tenantId,
          "Description vérifiée",
          input.profile.identity.description,
          "description",
        ),
        sectionEvidence(hero),
      ],
    });
  }

  const faq = input.sections.find((section) => section.type === "faq");
  if (faq && input.profile.faqs.length > 0) {
    const proposedBody = input.profile.faqs
      .slice(0, 5)
      .map((item) => `${item.question}\n${item.answer}`)
      .join("\n\n");
    candidates.push({
      websiteId: input.website.id,
      sectionId: faq.id,
      proposalKey: `faq-content:${faq.id}`,
      proposalType: "faq_content",
      title: "Aligner la FAQ sur les réponses vérifiées",
      rationale:
        "La proposition reprend mot pour mot les questions et réponses enregistrées dans le Business Twin, sans enrichissement externe.",
      expectedGain:
        "Répondre plus clairement aux questions fréquentes et réduire les demandes incomplètes.",
      riskSummary:
        "Les réponses doivent être relues si les conditions commerciales ou opérationnelles ont changé.",
      proposedTitle: faq.title || "Questions fréquentes",
      proposedBody,
      originalContentHash: hashWebsiteSectionContent(faq),
      evidence: [
        profileEvidence(
          input.website.tenantId,
          "FAQ vérifiée",
          `${input.profile.faqs.length} réponse(s) enregistrée(s)`,
          "faqs",
        ),
        sectionEvidence(faq),
      ],
    });
  }

  return candidates.map((candidate) => ({
    ...candidate,
    fingerprint: hashToken(
      toJson({
        generationVersion: websiteAiGenerationVersion,
        proposalKey: candidate.proposalKey,
        originalContentHash: candidate.originalContentHash,
        proposedTitle: candidate.proposedTitle,
        proposedBody: candidate.proposedBody,
        evidence: candidate.evidence,
      }),
    ),
  }));
}

export function hashWebsiteSectionContent(
  section: Pick<WebsiteSection, "title" | "body">,
) {
  return hashToken(toJson({ title: section.title, body: section.body }));
}

function profileEvidence(
  tenantId: string,
  label: string,
  observedValue: string,
  key: string,
): WebsiteAiEvidenceCandidate {
  return {
    type: "business_profile",
    ref: `${tenantId}:${key}`,
    label,
    observedValue: observedValue.slice(0, 500),
  };
}

function sectionEvidence(section: WebsiteSection): WebsiteAiEvidenceCandidate {
  return {
    type: "website_section",
    ref: section.id,
    label: "Version de section analysée",
    observedValue: `Titre actuel : ${section.title}`.slice(0, 500),
  };
}
