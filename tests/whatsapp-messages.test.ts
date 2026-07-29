import { describe, expect, it } from "vitest";
import {
  buildWhatsAppLink,
  normalizePhone,
} from "../src/modules/whatsapp/phone";
import { buildWhatsAppSuggestions } from "../src/modules/whatsapp/service";
import { whatsAppTemplates } from "../src/modules/whatsapp/templates";

describe("phone normalisation", () => {
  it("normalises the formats used by Antillean businesses", () => {
    // Mobile martiniquais saisi localement.
    expect(normalizePhone("0696 10 20 30")?.wa).toBe("596696102030");
    // Le même numéro déjà international, avec espaces.
    expect(normalizePhone("+596 696 10 20 30")?.wa).toBe("596696102030");
    // Notation 00 devant l'indicatif.
    expect(normalizePhone("00596696102030")?.wa).toBe("596696102030");
    // Fixe martiniquais.
    expect(normalizePhone("0596 00 00 00")?.wa).toBe("596596000000");
  });

  it("keeps a foreign number on its own country code", () => {
    expect(normalizePhone("+33 6 12 34 56 78")?.wa).toBe("33612345678");
    // Un numéro national français reste français si le pays est renseigné.
    expect(normalizePhone("06 12 34 56 78", "33")?.wa).toBe("33612345678");
  });

  it("refuses what cannot be dialled", () => {
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone("   ")).toBeNull();
    expect(normalizePhone("pas un numéro")).toBeNull();
    expect(normalizePhone("12")).toBeNull();
    expect(normalizePhone("+1234567890123456789")).toBeNull();
  });
});

describe("whatsapp link", () => {
  it("encodes the message so accents and line breaks survive", () => {
    const href = buildWhatsAppLink(
      "0696102030",
      "Bonjour, votre devis à 1 200 € est prêt.\nBonne journée",
    )!;
    expect(href.startsWith("https://wa.me/596696102030?text=")).toBe(true);

    const text = new URL(href).searchParams.get("text");
    expect(text).toBe("Bonjour, votre devis à 1 200 € est prêt.\nBonne journée");
    // Rien ne doit sortir du paramètre `text`.
    expect(href).not.toContain(" ");
    expect(href).not.toContain("\n");
  });

  it("does not let a crafted message forge extra parameters", () => {
    const href = buildWhatsAppLink(
      "0696102030",
      "coucou&phone=33600000000&text=autre",
    )!;
    const url = new URL(href);
    expect(url.searchParams.get("phone")).toBeNull();
    expect(url.searchParams.get("text")).toBe(
      "coucou&phone=33600000000&text=autre",
    );
    expect(url.pathname).toBe("/596696102030");
  });

  it("returns nothing when the number cannot be dialled", () => {
    expect(buildWhatsAppLink("", "Bonjour")).toBeNull();
    expect(buildWhatsAppLink("inconnu", "Bonjour")).toBeNull();
  });
});

describe("whatsapp suggestions", () => {
  it("prepares every template with the contact and business name", () => {
    const suggestions = buildWhatsAppSuggestions({
      phone: "+596 696 10 20 30",
      contactName: "Marie-Claude Dubois",
      businessName: "Garage Caraibes Auto",
    });

    expect(suggestions).toHaveLength(whatsAppTemplates.length);
    expect(suggestions.every((item) => item.href.startsWith("https://wa.me/"))).toBe(
      true,
    );

    const followUp = suggestions.find((item) => item.key === "lead_follow_up")!;
    // Le prénom composé n'est pas tronqué au premier tiret.
    expect(followUp.message).toContain("Marie-Claude");
    expect(followUp.message).toContain("Garage Caraibes Auto");
  });

  it("includes the amount only on the quotation follow-up", () => {
    const suggestions = buildWhatsAppSuggestions({
      phone: "0696102030",
      contactName: "Jean",
      businessName: "Garage Caraibes Auto",
      amountLabel: "1 250 €",
    });

    const opportunity = suggestions.find(
      (item) => item.key === "opportunity_follow_up",
    )!;
    expect(opportunity.message).toContain("1 250 €");

    const review = suggestions.find((item) => item.key === "review_request")!;
    expect(review.message).not.toContain("1 250 €");
  });

  it("restricts the list when specific templates are requested", () => {
    const suggestions = buildWhatsAppSuggestions({
      phone: "0696102030",
      contactName: "Jean",
      businessName: "Garage Caraibes Auto",
      templateKeys: ["review_request", "inconnu"],
    });

    expect(suggestions.map((item) => item.key)).toEqual(["review_request"]);
  });

  it("returns no suggestion for a contact without a usable number", () => {
    expect(
      buildWhatsAppSuggestions({
        phone: "",
        contactName: "Jean",
        businessName: "Garage Caraibes Auto",
      }),
    ).toEqual([]);
  });
});
