import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { prepareVerifiedMetaWhatsAppInboundMessage } from "../src/modules/channels";

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
function prepare(value = payload()) {
  const rawBody = JSON.stringify(value);
  return prepareVerifiedMetaWhatsAppInboundMessage({ rawBody, signature: `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}` }, secret, receivedAt);
}

describe("préparation entrante WhatsApp Cloud Meta", () => {
  it("normalise seulement après signature", () => {
    expect(prepare()).toMatchObject({ ok: true, message: { provider: "whatsapp_meta", adapterKey: "whatsapp-meta", senderAddress: "whatsapp:+596696000000", recipientAddress: "whatsapp:+987654321", text: "Bonjour Meta" } });
  });

  it("accepte l'enveloppe officielle complète et dérive des clés internes sûres", () => {
    const result = prepare(officialEnvelopePayload());
    expect(result).toMatchObject({
      ok: true,
      message: {
        externalMessageId:
          "wamid.HBgLMTU1NTAwMDIyMjIVAGHAYWZha2VfZXhhbXBsZQA=",
        senderAddress: "whatsapp:+15550002222",
        recipientAddress: "whatsapp:+7000000000000001",
        text: "Bonjour",
      },
    });
    if (!result.ok) throw new Error("Le payload officiel doit être accepté.");
    expect(result.message.idempotencyKey).toMatch(
      /^ingress:whatsapp_meta:[a-f0-9]{64}$/,
    );
    expect(result.message.correlationId).toMatch(/^meta_[a-f0-9]{64}$/);
    expect(result.message.idempotencyKey).not.toContain(
      result.message.externalMessageId,
    );
    const serialized = JSON.stringify(result.message);
    expect(serialized).not.toContain("Contact Exemple");
    expect(serialized).not.toContain("15550001111");
    expect(serialized).not.toContain("1760000000");
  });

  it("refuse le corps altéré et les lots ambigus", () => {
    const rawBody = JSON.stringify(payload());
    expect(prepareVerifiedMetaWhatsAppInboundMessage({ rawBody: `${rawBody} `, signature: `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}` }, secret, receivedAt)).toEqual({ ok: false, code: "invalid_signature" });
    const invalid = payload();
    invalid.entry.push(invalid.entry[0]);
    expect(prepare(invalid)).toEqual({ ok: false, code: "whatsapp_payload_invalid" });
  });
});
