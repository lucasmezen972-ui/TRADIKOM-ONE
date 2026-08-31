export type WhatsAppTemplateKey =
  | "lead_follow_up"
  | "opportunity_follow_up"
  | "appointment_reminder"
  | "review_request"
  | "after_sale";

export type WhatsAppTemplateInput = {
  contactName: string;
  businessName: string;
  /** Renseigné pour les modèles commerciaux uniquement. */
  amountLabel?: string;
};

export type WhatsAppTemplate = {
  key: WhatsAppTemplateKey;
  label: string;
  description: string;
  build(input: WhatsAppTemplateInput): string;
};

/**
 * Les modèles restent courts et tutoient peu : ils sont relus puis envoyés
 * par le dirigeant lui-même depuis WhatsApp. Le prénom est repris tel qu'il
 * figure dans la fiche, sans reformulation automatique.
 */
export const whatsAppTemplates: WhatsAppTemplate[] = [
  {
    key: "lead_follow_up",
    label: "Répondre à une demande",
    description: "Premier contact après une demande reçue sur le site.",
    build: ({ contactName, businessName }) =>
      `Bonjour ${firstName(contactName)}, ici ${businessName}. ` +
      `Vous nous avez contactés via notre site et je reviens vers vous. ` +
      `Dites-moi ce dont vous avez besoin et je vous réponds rapidement.`,
  },
  {
    key: "opportunity_follow_up",
    label: "Relancer un devis",
    description: "Relance d'une opportunité en attente de réponse.",
    build: ({ contactName, businessName, amountLabel }) =>
      `Bonjour ${firstName(contactName)}, ici ${businessName}. ` +
      `Je reviens vers vous au sujet de votre demande${
        amountLabel ? ` (${amountLabel})` : ""
      }. ` +
      `Souhaitez-vous que nous avancions ensemble ? Je reste disponible.`,
  },
  {
    key: "appointment_reminder",
    label: "Confirmer un rendez-vous",
    description: "Rappel avant un rendez-vous prévu.",
    build: ({ contactName, businessName }) =>
      `Bonjour ${firstName(contactName)}, ici ${businessName}. ` +
      `Je confirme notre rendez-vous. Si l'horaire ne vous convient plus, ` +
      `dites-le-moi et nous le décalons.`,
  },
  {
    key: "review_request",
    label: "Demander un avis",
    description: "Demande d'avis après une prestation terminée.",
    build: ({ contactName, businessName }) =>
      `Bonjour ${firstName(contactName)}, ici ${businessName}. ` +
      `Merci de votre confiance. Si vous avez été satisfait, un avis en ligne ` +
      `nous aide beaucoup. Merci d'avance.`,
  },
  {
    key: "after_sale",
    label: "Prendre des nouvelles",
    description: "Suivi après-vente pour vérifier que tout va bien.",
    build: ({ contactName, businessName }) =>
      `Bonjour ${firstName(contactName)}, ici ${businessName}. ` +
      `Je prends des nouvelles après notre intervention. Tout se passe bien ? ` +
      `N'hésitez pas si vous avez la moindre question.`,
  },
];

export function findWhatsAppTemplate(key: string) {
  return whatsAppTemplates.find((template) => template.key === key) ?? null;
}

function firstName(contactName: string) {
  const trimmed = contactName.trim();
  if (!trimmed) {
    return "";
  }
  return trimmed.split(/\s+/)[0]!;
}
