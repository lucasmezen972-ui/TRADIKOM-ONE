import {
  buildWhatsAppLink,
  defaultCountryCode,
  normalizePhone,
} from "@/modules/whatsapp/phone";
import {
  findWhatsAppTemplate,
  whatsAppTemplates,
  type WhatsAppTemplateInput,
} from "@/modules/whatsapp/templates";

export type WhatsAppSuggestion = {
  key: string;
  label: string;
  description: string;
  message: string;
  href: string;
};

/**
 * Construit les messages proposés pour un contact. Rien n'est envoyé : chaque
 * suggestion n'est qu'un lien qui ouvre WhatsApp avec le texte pré-rempli,
 * que le dirigeant relit et envoie lui-même.
 */
export function buildWhatsAppSuggestions(input: {
  phone: string;
  contactName: string;
  businessName: string;
  amountLabel?: string;
  countryCode?: string;
  templateKeys?: string[];
}): WhatsAppSuggestion[] {
  const normalized = normalizePhone(
    input.phone,
    input.countryCode ?? defaultCountryCode,
  );
  if (!normalized) {
    return [];
  }

  const templateInput: WhatsAppTemplateInput = {
    contactName: input.contactName,
    businessName: input.businessName,
    amountLabel: input.amountLabel,
  };

  const selected = input.templateKeys
    ? input.templateKeys
        .map((key) => findWhatsAppTemplate(key))
        .filter((template) => template !== null)
    : whatsAppTemplates;

  return selected.flatMap((template) => {
    const message = template.build(templateInput);
    const href = buildWhatsAppLink(
      input.phone,
      message,
      input.countryCode ?? defaultCountryCode,
    );
    if (!href) {
      return [];
    }
    return [
      {
        key: template.key,
        label: template.label,
        description: template.description,
        message,
        href,
      },
    ];
  });
}
