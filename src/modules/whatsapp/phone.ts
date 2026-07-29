/**
 * Indicatif par défaut : la Martinique et la Guadeloupe partagent le +596/+590
 * en fixe, mais les mobiles antillais composés localement commencent par 0696
 * ou 0690. Un numéro saisi sans indicatif est donc interprété selon le pays de
 * l'organisation, jamais deviné à partir du seul préfixe.
 */
export const defaultCountryCode = "596";

export type NormalizedPhone = {
  /** Format E.164 sans le `+`, tel qu'attendu par wa.me. */
  wa: string;
  /** Format lisible, conservé pour l'affichage. */
  display: string;
};

export function normalizePhone(
  value: string,
  countryCode = defaultCountryCode,
): NormalizedPhone | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length === 0) {
    return null;
  }

  let international: string;
  if (hasPlus || digits.startsWith("00")) {
    international = digits.startsWith("00") ? digits.slice(2) : digits;
  } else if (digits.startsWith("0")) {
    // Numéro national : le 0 de service disparaît devant l'indicatif pays.
    international = `${countryCode}${digits.slice(1)}`;
  } else if (digits.startsWith(countryCode)) {
    international = digits;
  } else {
    international = `${countryCode}${digits}`;
  }

  // Bornes E.164 : un numéro plus court ou plus long n'est pas composable.
  if (international.length < 8 || international.length > 15) {
    return null;
  }

  return { wa: international, display: `+${international}` };
}

/**
 * Construit un lien « click to chat ». WhatsApp ouvre la conversation avec le
 * message pré-rempli ; l'envoi reste un geste explicite de l'utilisateur.
 * Aucun message n'est transmis par TRADIKOM ONE.
 */
export function buildWhatsAppLink(
  phone: string,
  message: string,
  countryCode = defaultCountryCode,
) {
  const normalized = normalizePhone(phone, countryCode);
  if (!normalized) {
    return null;
  }
  const text = message.slice(0, 1000);
  return `https://wa.me/${normalized.wa}?text=${encodeURIComponent(text)}`;
}
