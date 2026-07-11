import type {
  BusinessProfile,
  Website,
  WebsiteSection,
  WebsiteTemplateKey,
  WebsiteTheme,
} from "@/lib/types";
import { id, nowIso } from "@/lib/security";

export type OnboardingInput = {
  companyName: string;
  category: string;
  description: string;
  services: string;
  products: string;
  targetCustomers: string;
  address: string;
  serviceAreas: string;
  phone: string;
  email: string;
  openingHours: string;
  desiredCallsToAction: string;
  tone: string;
  colors: string;
  existingWebsite: string;
  socialLinks: string;
  photos: string;
  mainObjective: string;
  faqs: string;
  templateKey: WebsiteTemplateKey;
};

export function buildBusinessTwin(input: OnboardingInput): BusinessProfile {
  const services = splitList(input.services);
  const products = splitList(input.products);
  const areas = splitList(input.serviceAreas);
  const callsToAction = splitList(input.desiredCallsToAction);
  const colors = splitList(input.colors).slice(0, 3);

  return {
    identity: {
      companyName: input.companyName,
      category: input.category,
      description: input.description,
      existingWebsite: input.existingWebsite || undefined,
    },
    brand: {
      tone: input.tone || "professionnel, chaleureux et direct",
      colors: colors.length > 0 ? colors : ["#08111f", "#19c6b7", "#fffaf1"],
      logoUrl: undefined,
      photoUrls: splitList(input.photos),
    },
    services,
    products,
    targetCustomers: input.targetCustomers,
    geographicalAreas: areas,
    openingHours: input.openingHours,
    salesObjectives: input.mainObjective,
    approvedClaims: [
      "Entreprise locale basée en Martinique",
      "Réponse rapide aux demandes entrantes",
      "Accompagnement clair et humain",
    ],
    forbiddenClaims: [
      "Garanties de résultats non vérifiées",
      "Prix inventés ou promotions non validées",
      "Certifications non fournies par l'entreprise",
    ],
    faqs: parseFaqs(input.faqs),
    contactMethods: {
      address: input.address,
      phone: input.phone,
      email: input.email,
      socialLinks: splitList(input.socialLinks),
    },
    websitePreferences: {
      desiredCallsToAction:
        callsToAction.length > 0
          ? callsToAction
          : ["Demander un devis", "Prendre rendez-vous"],
      preferredTemplate: input.templateKey,
    },
    automationPreferences: {
      leadFollowUpDelayHours: 24,
      notificationChannels: ["mock_email", "mock_whatsapp"],
      approvalPolicy: "user_approval_required",
    },
    futureKnowledgeSources: [
      "documents",
      "menus",
      "catalogues",
      "notes vocales",
      "avis clients",
      "logiciels métier",
      "conversations historiques",
    ],
  };
}

export function createWebsiteDraft(
  tenantId: string,
  profile: BusinessProfile,
): { website: Website; sections: WebsiteSection[] } {
  const now = nowIso();
  const websiteId = id("site");
  const templateKey = profile.websitePreferences.preferredTemplate;
  const theme = createTheme(profile, templateKey);

  const website: Website = {
    id: websiteId,
    tenantId,
    name: `Site ${profile.identity.companyName}`,
    templateKey,
    status: "draft",
    theme,
    createdAt: now,
    updatedAt: now,
  };

  const primaryCta =
    profile.websitePreferences.desiredCallsToAction[0] ?? "Nous contacter";
  const services = profile.services.length > 0 ? profile.services : ["Conseil"];
  const areas =
    profile.geographicalAreas.length > 0
      ? profile.geographicalAreas
      : ["Martinique"];

  const sections: Omit<WebsiteSection, "id" | "tenantId" | "websiteId">[] = [
    {
      type: "hero",
      position: 1,
      enabled: true,
      title: `${profile.identity.companyName}, votre partenaire local`,
      body: profile.identity.description,
      imageUrl: imageForTemplate(templateKey),
      buttonLabel: primaryCta,
      buttonHref: "#contact",
      data: { eyebrow: profile.identity.category },
    },
    {
      type: "introduction",
      position: 2,
      enabled: true,
      title: "Une entreprise proche de ses clients",
      body: `Nous accompagnons ${profile.targetCustomers || "les clients locaux"} avec une approche ${profile.brand.tone}.`,
      data: {},
    },
    {
      type: "services",
      position: 3,
      enabled: true,
      title: "Nos services",
      body: "Des prestations pensées pour gagner du temps et avancer sereinement.",
      data: { items: services },
    },
    {
      type: "benefits",
      position: 4,
      enabled: true,
      title: "Pourquoi nous choisir",
      body: "Un contact simple, une réponse rapide et un suivi clair.",
      data: {
        items: [
          "Conseil adapté au terrain martiniquais",
          "Suivi humain après chaque demande",
          "Informations utiles avant de vous déplacer",
        ],
      },
    },
    {
      type: "hours",
      position: 5,
      enabled: true,
      title: "Horaires",
      body: profile.openingHours || "Horaires communiqués sur demande.",
      data: {},
    },
    {
      type: "coverage",
      position: 6,
      enabled: true,
      title: "Zone d'intervention",
      body: `Nous intervenons principalement sur ${areas.join(", ")}.`,
      data: { areas },
    },
    {
      type: "faq",
      position: 7,
      enabled: true,
      title: "Questions fréquentes",
      body: "Les réponses aux demandes les plus courantes.",
      data: { items: profile.faqs },
    },
    {
      type: "contact",
      position: 8,
      enabled: true,
      title: "Parlez-nous de votre besoin",
      body: "Laissez vos coordonnées, nous revenons vers vous rapidement.",
      buttonLabel: "Envoyer la demande",
      buttonHref: "#contact",
      data: { phone: profile.contactMethods.phone, email: profile.contactMethods.email },
    },
    {
      type: "footer",
      position: 9,
      enabled: true,
      title: profile.identity.companyName,
      body: `${profile.contactMethods.address} - ${profile.contactMethods.phone}`,
      data: {},
    },
  ];

  return {
    website,
    sections: sections.map((section) => ({
      ...section,
      id: id("section"),
      tenantId,
      websiteId,
    })),
  };
}

export function defaultGarageOnboarding(): OnboardingInput {
  return {
    companyName: "Garage Caraibes Auto",
    category: "Garage automobile",
    description:
      "Garage independant au Lamentin specialise dans l'entretien, le diagnostic et les reparations du quotidien.",
    services:
      "entretien automobile, diagnostic, climatisation, freinage, vidange",
    products: "forfaits entretien, controles avant depart, devis reparation",
    targetCustomers:
      "automobilistes de Martinique, familles, professionnels avec vehicules legers",
    address: "Zone de Californie, Le Lamentin, Martinique",
    serviceAreas: "Le Lamentin, Fort-de-France, Ducos, Schoelcher",
    phone: "+596 596 00 00 00",
    email: "contact@garage-caraibes-auto.example",
    openingHours:
      "Lundi au vendredi 7h30-17h30, samedi matin sur rendez-vous",
    desiredCallsToAction: "Demander un devis, Prendre rendez-vous",
    tone: "fiable, clair et rassurant",
    colors: "#08111f, #19c6b7, #fffaf1",
    existingWebsite: "",
    socialLinks: "https://facebook.example/garage-caraibes-auto",
    photos:
      "https://images.unsplash.com/photo-1486006920555-c77dcf18193c?auto=format&fit=crop&w=1400&q=80",
    mainObjective: "Recevoir plus de demandes de devis qualifiees",
    faqs:
      "Puis-je demander un devis en ligne ? | Oui, decrivez votre besoin et nous vous recontactons rapidement.\nFaites-vous le diagnostic climatisation ? | Oui, nous controlons le circuit et proposons une intervention adaptee.",
    templateKey: "artisan",
  };
}

function createTheme(
  profile: BusinessProfile,
  templateKey: WebsiteTemplateKey,
): WebsiteTheme {
  const [primary, accent, background] = profile.brand.colors;

  const defaults: Record<WebsiteTemplateKey, WebsiteTheme> = {
    artisan: {
      primary: primary ?? "#08111f",
      accent: accent ?? "#19c6b7",
      background: background ?? "#fffaf1",
      text: "#111827",
      radius: "8px",
    },
    restaurant: {
      primary: primary ?? "#172554",
      accent: accent ?? "#f97316",
      background: background ?? "#fff7ed",
      text: "#1f2937",
      radius: "8px",
    },
    beauty: {
      primary: primary ?? "#27272a",
      accent: accent ?? "#e11d48",
      background: background ?? "#fff1f2",
      text: "#18181b",
      radius: "8px",
    },
  };

  return defaults[templateKey];
}

function imageForTemplate(templateKey: WebsiteTemplateKey) {
  const images: Record<WebsiteTemplateKey, string> = {
    artisan:
      "https://images.unsplash.com/photo-1486006920555-c77dcf18193c?auto=format&fit=crop&w=1400&q=80",
    restaurant:
      "https://images.unsplash.com/photo-1555396273-367ea4eb4db5?auto=format&fit=crop&w=1400&q=80",
    beauty:
      "https://images.unsplash.com/photo-1522337360788-8b13dee7a37e?auto=format&fit=crop&w=1400&q=80",
  };

  return images[templateKey];
}

function splitList(value: string) {
  return value
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseFaqs(value: string) {
  const rows = value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);

  if (rows.length === 0) {
    return [
      {
        question: "Comment prendre contact ?",
        answer:
          "Envoyez une demande depuis le site ou appelez directement l'entreprise.",
      },
    ];
  }

  return rows.map((row) => {
    const [question, answer] = row.split("|").map((item) => item.trim());
    return {
      question: question || "Question",
      answer: answer || "Nous vous repondrons avec les informations utiles.",
    };
  });
}
