import {
  getExpectedBodyHash,
  getExpectedTwilioSignature,
} from "twilio";
import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyTwilioWebhook } from "../src/modules/channels";

const authToken = "twilio_test_auth_token";
const url = "https://example.test/api/webhooks/twilio/whatsapp?source=twilio";
const messageSid = `SM${"a".repeat(32)}`;
const accountSid = `AC${"b".repeat(32)}`;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("vérification officielle des webhooks WhatsApp/Twilio", () => {
  it("refuse avant traitement quand le token n'est pas configuré", () => {
    expect(
      verifyTwilioWebhook(
        {
          url,
          contentType: "application/x-www-form-urlencoded",
          rawBody: "Body=secret",
          signature: "signature",
        },
        undefined,
      ),
    ).toEqual({ ok: false, code: "not_configured" });
  });

  it("vérifie l'URL exacte et tous les paramètres de formulaire", () => {
    const rawBody = new URLSearchParams({
      AccountSid: accountSid,
      MessageSid: messageSid,
      From: "whatsapp:+15005550006",
      To: "whatsapp:+15005550007",
      Body: "Bonjour depuis WhatsApp",
    }).toString();
    const parameters = Object.fromEntries(new URLSearchParams(rawBody));
    const signature = getExpectedTwilioSignature(authToken, url, parameters);
    const networkCall = vi.fn();
    vi.stubGlobal("fetch", networkCall);

    const result = verifyTwilioWebhook(
      {
        url,
        contentType: "application/x-www-form-urlencoded; charset=utf-8",
        rawBody,
        signature,
      },
      authToken,
    );

    expect(result).toEqual({
      ok: true,
      event: {
        signatureVerified: true,
        payloadKind: "form",
        externalEventId: messageSid,
        safeAccountReference: accountSid,
        parameterCount: 5,
      },
    });
    expect(JSON.stringify(result)).not.toContain("Bonjour");
    expect(JSON.stringify(result)).not.toContain("+15005550006");
    expect(networkCall).not.toHaveBeenCalled();
  });

  it("préserve les paramètres dupliqués attendus par le SDK", () => {
    const rawBody = `MessageSid=${messageSid}&MediaUrl=un&MediaUrl=deux`;
    const signature = getExpectedTwilioSignature(authToken, url, {
      MessageSid: messageSid,
      MediaUrl: ["un", "deux"],
    });

    expect(
      verifyTwilioWebhook(
        {
          url,
          contentType: "application/x-www-form-urlencoded",
          rawBody,
          signature,
        },
        authToken,
      ),
    ).toMatchObject({
      ok: true,
      event: { externalEventId: messageSid, parameterCount: 3 },
    });
  });

  it("refuse une altération du corps ou de l'URL", () => {
    const parameters = { MessageSid: messageSid, Body: "original" };
    const signature = getExpectedTwilioSignature(authToken, url, parameters);

    expect(
      verifyTwilioWebhook(
        {
          url,
          contentType: "application/x-www-form-urlencoded",
          rawBody: new URLSearchParams({ ...parameters, Body: "modifié" }).toString(),
          signature,
        },
        authToken,
      ),
    ).toEqual({ ok: false, code: "invalid_signature" });
    expect(
      verifyTwilioWebhook(
        {
          url: `${url}&extra=1`,
          contentType: "application/x-www-form-urlencoded",
          rawBody: new URLSearchParams(parameters).toString(),
          signature,
        },
        authToken,
      ),
    ).toEqual({ ok: false, code: "invalid_signature" });
  });

  it("utilise la validation officielle du corps JSON avec bodySHA256", () => {
    const rawBody = '{"event":"test","content":"non exposé"}';
    const jsonUrl = `https://example.test/api/webhooks/twilio/whatsapp?bodySHA256=${getExpectedBodyHash(rawBody)}`;
    const signature = getExpectedTwilioSignature(authToken, jsonUrl, {});

    expect(
      verifyTwilioWebhook(
        {
          url: jsonUrl,
          contentType: "application/json",
          rawBody,
          signature,
        },
        authToken,
      ),
    ).toEqual({
      ok: true,
      event: { signatureVerified: true, payloadKind: "json" },
    });
  });

  it("borne les octets, le type, l'URL et le nombre de paramètres", () => {
    expect(
      verifyTwilioWebhook(
        {
          url,
          contentType: "application/json",
          rawBody: "é".repeat(512 * 1024),
          signature: "signature",
        },
        authToken,
      ),
    ).toEqual({ ok: false, code: "payload_too_large" });

    expect(
      verifyTwilioWebhook(
        {
          url,
          contentType: "text/plain",
          rawBody: "test",
          signature: "signature",
        },
        authToken,
      ),
    ).toEqual({ ok: false, code: "unsupported_content_type" });

    expect(
      verifyTwilioWebhook(
        {
          url: "http://example.test/webhook",
          contentType: "application/json",
          rawBody: "{}",
          signature: "signature",
        },
        authToken,
      ),
    ).toEqual({ ok: false, code: "url_invalid" });

    const oversizedForm = Array.from(
      { length: 129 },
      (_, index) => `p${index}=v`,
    ).join("&");
    expect(
      verifyTwilioWebhook(
        {
          url,
          contentType: "application/x-www-form-urlencoded",
          rawBody: oversizedForm,
          signature: "signature",
        },
        authToken,
      ),
    ).toEqual({ ok: false, code: "payload_invalid" });
  });
});
