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
function prepare(value = payload()) {
  const rawBody = JSON.stringify(value);
  return prepareVerifiedMetaWhatsAppInboundMessage({ rawBody, signature: `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}` }, secret, receivedAt);
}

describe("préparation entrante WhatsApp Cloud Meta", () => {
  it("normalise seulement après signature", () => {
    expect(prepare()).toMatchObject({ ok: true, message: { provider: "whatsapp_meta", adapterKey: "whatsapp-meta", senderAddress: "whatsapp:+596696000000", recipientAddress: "whatsapp:+987654321", text: "Bonjour Meta" } });
  });

  it("refuse le corps altéré et les lots ambigus", () => {
    const rawBody = JSON.stringify(payload());
    expect(prepareVerifiedMetaWhatsAppInboundMessage({ rawBody: `${rawBody} `, signature: `sha256=${createHmac("sha256", secret).update(rawBody).digest("hex")}` }, secret, receivedAt)).toEqual({ ok: false, code: "invalid_signature" });
    const invalid = payload();
    invalid.entry.push(invalid.entry[0]);
    expect(prepare(invalid)).toEqual({ ok: false, code: "whatsapp_payload_invalid" });
  });
});
