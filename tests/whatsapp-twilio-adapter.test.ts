import { getExpectedTwilioSignature } from "twilio";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareVerifiedWhatsAppInboundMessage } from "../src/modules/channels";

const authToken = "twilio_test_auth_token";
const url = "https://app.example.test/api/webhooks/twilio/whatsapp";
const accountSid = `AC${"a".repeat(32)}`;
const messageSid = `SM${"b".repeat(32)}`;
const mediaSid = `ME${"c".repeat(32)}`;
const receivedAt = "2026-07-30T17:10:00.000Z";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("préparation entrante WhatsApp/Twilio", () => {
  it("normalise seulement après signature, sans réseau", () => {
    const parameters = {
      AccountSid: accountSid,
      MessageSid: messageSid,
      From: "whatsapp:+15005550006",
      To: "whatsapp:+596696000000",
      Body: "  Bonjour depuis WhatsApp  ",
      NumMedia: "0",
    };
    const networkCall = vi.fn();
    vi.stubGlobal("fetch", networkCall);

    expect(prepare(parameters)).toEqual({
      ok: true,
      message: {
        provider: "whatsapp_twilio",
        adapterKey: "whatsapp-twilio",
        externalMessageId: messageSid,
        safeAccountReference: accountSid,
        senderAddress: "whatsapp:+15005550006",
        recipientAddress: "whatsapp:+596696000000",
        text: "Bonjour depuis WhatsApp",
        media: [],
        idempotencyKey: `ingress:whatsapp_twilio:${messageSid}`,
        correlationId: `twilio_${messageSid}`,
        receivedAt,
      },
    });
    expect(networkCall).not.toHaveBeenCalled();
  });

  it("refuse avant normalisation lorsque la signature est altérée", () => {
    const parameters = baseParameters();
    const rawBody = new URLSearchParams(parameters).toString();
    const result = prepareVerifiedWhatsAppInboundMessage(
      {
        url,
        contentType: "application/x-www-form-urlencoded",
        rawBody: `${rawBody}&Body=altéré`,
        signature: getExpectedTwilioSignature(authToken, url, parameters),
      },
      authToken,
      receivedAt,
    );

    expect(result).toEqual({ ok: false, code: "invalid_signature" });
  });

  it("prépare les métadonnées média Twilio sans les télécharger", () => {
    const parameters = {
      ...baseParameters(),
      Body: "",
      NumMedia: "1",
      MediaUrl0: `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages/${messageSid}/Media/${mediaSid}`,
      MediaContentType0: "image/jpeg",
    };

    expect(prepare(parameters)).toMatchObject({
      ok: true,
      message: {
        media: [
          {
            externalMediaId: mediaSid,
            contentType: "image/jpeg",
            providerUrl: parameters.MediaUrl0,
          },
        ],
      },
    });
  });

  it.each([
    ["adresse non WhatsApp", { From: "+15005550006" }],
    ["SID invalide", { MessageSid: "SM_invalide" }],
    ["doublon sensible", { From: ["whatsapp:+15005550006", "whatsapp:+15005550007"] }],
    ["trop de médias", { NumMedia: "11" }],
    ["message vide", { Body: "", NumMedia: "0" }],
  ])("refuse %s", (_label, override) => {
    expect(prepare({ ...baseParameters(), ...override })).toEqual({
      ok: false,
      code: "whatsapp_payload_invalid",
    });
  });

  it("refuse une URL média externe même quand le webhook est signé", () => {
    expect(
      prepare({
        ...baseParameters(),
        Body: "",
        NumMedia: "1",
        MediaUrl0: `https://evil.example/${mediaSid}`,
        MediaContentType0: "image/jpeg",
      }),
    ).toEqual({ ok: false, code: "whatsapp_payload_invalid" });
  });
});

function baseParameters() {
  return {
    AccountSid: accountSid,
    MessageSid: messageSid,
    From: "whatsapp:+15005550006",
    To: "whatsapp:+596696000000",
    Body: "Bonjour",
    NumMedia: "0",
  };
}

function prepare(parameters: Record<string, string | string[]>) {
  const rawBody = new URLSearchParams();
  for (const [name, value] of Object.entries(parameters)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      rawBody.append(name, item);
    }
  }
  const signature = getExpectedTwilioSignature(authToken, url, parameters);
  return prepareVerifiedWhatsAppInboundMessage(
    {
      url,
      contentType: "application/x-www-form-urlencoded",
      rawBody: rawBody.toString(),
      signature,
    },
    authToken,
    receivedAt,
  );
}
