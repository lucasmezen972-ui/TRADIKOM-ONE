import { describe, expect, it, vi } from "vitest";
import { handlePreparedTwilioWebhookRequest } from "../src/modules/channels";

const requestUrl = "https://internal.example.test/api/webhooks/twilio/whatsapp";
const verificationUrl =
  "https://app.tradikom.test/api/webhooks/twilio/whatsapp?source=twilio";
const headers = {
  "content-type": "application/x-www-form-urlencoded; charset=utf-8",
  "x-twilio-signature": "signature-test",
};

describe("point d'entrée HTTP WhatsApp/Twilio préparé", () => {
  it.each(["disabled", "not_configured", "awaiting_human_auth"] as const)(
    "refuse avant de lire ou vérifier quand le canal est %s",
    async (state) => {
      const receive = vi.fn();
      const response = await handlePreparedTwilioWebhookRequest(
        request("Body=contenu+prive"),
        { state, verificationUrl, receive },
      );

      expect(response.status).toBe(503);
      expect(response.headers.get("retry-after")).toBe("300");
      expect(receive).not.toHaveBeenCalled();
    },
  );

  it("utilise l'URL publique configurée et transmet exactement le corps brut", async () => {
    const rawBody = "Body=Bonjour%20%2B%20WhatsApp&MediaUrl=un&MediaUrl=deux";
    const receive = vi.fn().mockResolvedValue({ accepted: true });
    const response = await handlePreparedTwilioWebhookRequest(
      request(rawBody),
      { state: "ready", verificationUrl, receive },
    );

    expect(receive).toHaveBeenCalledWith({
      url: verificationUrl,
      contentType: headers["content-type"],
      rawBody,
      signature: "signature-test",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it.each([undefined, "http://app.tradikom.test/webhook", "url-invalide"])(
    "refuse une configuration URL absente ou invalide avant lecture (%s)",
    async (configuredUrl) => {
      const receive = vi.fn();
      const response = await handlePreparedTwilioWebhookRequest(
        request("Body=prive"),
        { state: "ready", verificationUrl: configuredUrl, receive },
      );

      expect(response.status).toBe(503);
      expect(receive).not.toHaveBeenCalled();
    },
  );

  it("borne le type et la taille déclarée ou effectivement reçue", async () => {
    const receive = vi.fn();
    const wrongType = await handlePreparedTwilioWebhookRequest(
      request("texte", { "content-type": "text/plain" }),
      { state: "ready", verificationUrl, receive },
    );
    const declaredOversized = await handlePreparedTwilioWebhookRequest(
      request("Body=test", { "content-length": String(512 * 1024 + 1) }),
      { state: "ready", verificationUrl, receive },
    );
    const receivedOversized = await handlePreparedTwilioWebhookRequest(
      request("é".repeat(300 * 1024)),
      { state: "ready", verificationUrl, receive },
    );

    expect(wrongType.status).toBe(415);
    expect(declaredOversized.status).toBe(413);
    expect(receivedOversized.status).toBe(413);
    expect(receive).not.toHaveBeenCalled();
  });

  it("refuse l'UTF-8 invalide avant vérification", async () => {
    const receive = vi.fn();
    const response = await handlePreparedTwilioWebhookRequest(
      new Request(requestUrl, {
        method: "POST",
        headers,
        body: new Uint8Array([0xc3, 0x28]),
      }),
      { state: "ready", verificationUrl, receive },
    );

    expect(response.status).toBe(400);
    expect(receive).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid_signature", 401],
    ["payload_too_large", 413],
    ["unsupported_content_type", 415],
    ["url_invalid", 400],
    ["payload_invalid", 400],
    ["not_configured", 503],
    ["channel_provider_endpoint_not_found", 503],
  ] as const)("normalise %s sans exposer le code interne", async (code, status) => {
    const response = await handlePreparedTwilioWebhookRequest(
      request("Body=contenu-prive"),
      {
        state: "ready",
        verificationUrl,
        receive: () => ({ accepted: false, code }),
      },
    );
    const body = await response.text();

    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).not.toContain(code);
    expect(body).not.toContain("contenu-prive");
    if (code === "channel_provider_endpoint_not_found") {
      expect(response.headers.get("retry-after")).toBe("60");
    }
  });
});

function request(body: string, extraHeaders: Record<string, string> = {}) {
  return new Request(requestUrl, {
    method: "POST",
    headers: { ...headers, ...extraHeaders },
    body,
  });
}
