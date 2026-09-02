import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prepareVerifiedMetaWhatsAppInboundMessages } from "../src/modules/channels";

const secret = "meta_app_secret_for_adapter_tests_123456";
const receivedAt = "2026-08-19T15:40:00.000Z";

function payload() {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "123456789",
        changes: [
          {
            field: "messages",
            value: {
              metadata: { phone_number_id: "987654321" },
              messages: [
                {
                  id: "wamid.HBgMNTk2Njk2MDAwMDA",
                  from: "596696000000",
                  type: "text",
                  text: { body: "Bonjour Meta" },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}

function officialEnvelopePayload() {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "200000000000000001",
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "15550001111",
                phone_number_id: "7000000000000001",
              },
              contacts: [
                {
                  profile: { name: "Contact Exemple" },
                  wa_id: "15550002222",
                },
              ],
              messages: [
                {
                  from: "15550002222",
                  id: "wamid.HBgLMTU1NTAwMDIyMjIVAGHAYWZha2VfZXhhbXBsZQA=",
                  timestamp: "1760000000",
                  text: { body: "Bonjour" },
                  type: "text",
                },
              ],
            },
            field: "messages",
          },
        ],
      },
    ],
  };
}
function prepare(value: unknown = payload()) {
  const rawBody = JSON.stringify(value);
  return prepareVerifiedMetaWhatsAppInboundMessages({ rawBody, signature: `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}` }, secret, receivedAt);
}

describe("préparation entrante WhatsApp Cloud Meta", () => {
  it("normalise seulement après signature", () => {
    expect(prepare()).toMatchObject({ ok: true, messages: [{ provider: "whatsapp_meta", adapterKey: "whatsapp-meta", senderAddress: "whatsapp:+596696000000", recipientAddress: "whatsapp:+987654321", text: "Bonjour Meta" }] });
  });

  it("accepte l'enveloppe officielle complète et dérive des clés internes sûres", () => {
    const result = prepare(officialEnvelopePayload());
    expect(result).toMatchObject({
      ok: true,
      messages: [{
        externalMessageId:
          "wamid.HBgLMTU1NTAwMDIyMjIVAGHAYWZha2VfZXhhbXBsZQA=",
        senderAddress: "whatsapp:+15550002222",
        recipientAddress: "whatsapp:+7000000000000001",
        text: "Bonjour",
      }],
    });
    if (!result.ok) throw new Error("Le payload officiel doit être accepté.");
    expect(result.messages[0].idempotencyKey).toMatch(
      /^ingress:whatsapp_meta:[a-f0-9]{64}$/,
    );
    expect(result.messages[0].correlationId).toMatch(/^meta_[a-f0-9]{64}$/);
    expect(result.messages[0].idempotencyKey).not.toContain(
      result.messages[0].externalMessageId,
    );
    const serialized = JSON.stringify(result.messages);
    expect(serialized).not.toContain("Contact Exemple");
    expect(serialized).not.toContain("15550001111");
    expect(serialized).not.toContain("1760000000");
  });

  it("normalise les cinq médias officiels sans propager leurs métadonnées", () => {
    const checksum = "a".repeat(64);
    const cases = [
      {
        type: "image",
        media: {
          id: "2754859441498128",
          mime_type: "image/jpeg",
          sha256: checksum,
          caption: "Photo du chantier",
        },
        text: "Photo du chantier",
      },
      {
        type: "audio",
        media: {
          id: "2754859441498129",
          mime_type: "audio/ogg",
          sha256: checksum,
          voice: true,
        },
        text: null,
      },
      {
        type: "document",
        media: {
          id: "2754859441498130",
          mime_type: "application/pdf",
          sha256: checksum,
          filename: "devis-confidentiel.pdf",
          caption: "Voici le devis",
        },
        text: "Voici le devis",
      },
      {
        type: "video",
        media: {
          id: "2754859441498131",
          mime_type: "video/mp4",
          sha256: checksum,
          caption: "Démonstration",
        },
        text: "Démonstration",
      },
      {
        type: "sticker",
        media: {
          id: "2754859441498132",
          mime_type: "image/webp",
          sha256: checksum,
          animated: false,
        },
        text: null,
      },
    ] as const;

    for (const [index, mediaCase] of cases.entries()) {
      const result = prepare(
        mediaPayload({
          id: `wamid.media_${mediaCase.type}_${index}`,
          from: "15550002222",
          timestamp: "1760000000",
          type: mediaCase.type,
          [mediaCase.type]: mediaCase.media,
        }),
      );
      expect(result).toMatchObject({
        ok: true,
        messages: [{ mediaKind: mediaCase.type, text: mediaCase.text }],
      });
      if (!result.ok) throw new Error("Le média Meta doit être accepté.");
      const normalized = JSON.stringify(result.messages);
      expect(normalized).not.toContain(mediaCase.media.id);
      expect(normalized).not.toContain(checksum);
      expect(normalized).not.toContain(mediaCase.media.mime_type);
      expect(normalized).not.toContain("devis-confidentiel.pdf");
    }
  });

  it("refuse un média non borné ou enrichi d'une URL fournisseur", () => {
    const baseImage = {
      id: "2754859441498128",
      mime_type: "image/jpeg",
      sha256: "a".repeat(64),
    };
    for (const image of [
      { ...baseImage, sha256: "invalide" },
      { ...baseImage, mime_type: "image/svg+xml" },
      { ...baseImage, url: "https://graph.facebook.com/media" },
    ]) {
      expect(
        prepare(
          mediaPayload({
            id: "wamid.media_invalid",
            from: "15550002222",
            type: "image",
            image,
          }),
        ),
      ).toEqual({ ok: false, code: "whatsapp_payload_invalid" });
    }
  });

  it("normalise tous les messages des tableaux entry et changes dans leur ordre", () => {
    const batch = payload();
    batch.entry[0].changes[0].value.messages.push({
      ...batch.entry[0].changes[0].value.messages[0],
      id: "wamid.batch_message_2",
      text: { body: "Deux" },
    });
    const secondChange = structuredClone(batch.entry[0].changes[0]);
    secondChange.value.metadata.phone_number_id = "987654322";
    secondChange.value.messages = [{
      ...secondChange.value.messages[0],
      id: "wamid.batch_message_3",
      text: { body: "Trois" },
    }];
    batch.entry[0].changes.push(secondChange);
    const secondEntry = structuredClone(batch.entry[0]);
    secondEntry.id = "123456790";
    secondEntry.changes = [structuredClone(secondChange)];
    secondEntry.changes[0].value.messages[0].id = "wamid.batch_message_4";
    secondEntry.changes[0].value.messages[0].text.body = "Quatre";
    batch.entry.push(secondEntry);

    const result = prepare(batch);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error("Le lot Meta doit être accepté.");
    expect(result.messages.map((message) => message.text)).toEqual([
      "Bonjour Meta",
      "Deux",
      "Trois",
      "Quatre",
    ]);
    expect(result.messages.map((message) => message.safeAccountReference)).toEqual([
      "123456789",
      "123456789",
      "123456789",
      "123456790",
    ]);
  });

  it("refuse le corps altéré et les tableaux hors borne", () => {
    const rawBody = JSON.stringify(payload());
    expect(prepareVerifiedMetaWhatsAppInboundMessages({ rawBody: `${rawBody} `, signature: `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}` }, secret, receivedAt)).toEqual({ ok: false, code: "invalid_signature" });

    const entriesOverflow = payload();
    entriesOverflow.entry = Array.from(
      { length: 11 },
      () => entriesOverflow.entry[0],
    );
    const changesOverflow = payload();
    changesOverflow.entry[0].changes = Array.from(
      { length: 11 },
      () => changesOverflow.entry[0].changes[0],
    );
    const messagesOverflow = payload();
    messagesOverflow.entry[0].changes[0].value.messages = Array.from(
      { length: 11 },
      () => messagesOverflow.entry[0].changes[0].value.messages[0],
    );
    const totalOverflow = payload();
    const fullChange = structuredClone(totalOverflow.entry[0].changes[0]);
    fullChange.value.messages = Array.from(
      { length: 10 },
      () => structuredClone(fullChange.value.messages[0]),
    );
    totalOverflow.entry[0].changes = Array.from(
      { length: 10 },
      () => structuredClone(fullChange),
    );
    totalOverflow.entry.push(structuredClone(payload().entry[0]));

    for (const invalid of [
      entriesOverflow,
      changesOverflow,
      messagesOverflow,
      totalOverflow,
    ]) {
      expect(prepare(invalid)).toEqual({
        ok: false,
        code: "whatsapp_payload_invalid",
      });
    }
  });
});

function mediaPayload(message: Record<string, unknown>) {
  return {
    object: "whatsapp_business_account",
    entry: [
      {
        id: "200000000000000001",
        changes: [
          {
            value: {
              messaging_product: "whatsapp",
              metadata: {
                display_phone_number: "15550001111",
                phone_number_id: "7000000000000001",
              },
              messages: [message],
            },
            field: "messages",
          },
        ],
      },
    ],
  };
}
