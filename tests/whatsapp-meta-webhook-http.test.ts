import { describe, expect, it, vi } from "vitest";
import { handlePreparedMetaWhatsAppWebhookRequest } from "../src/modules/channels";

const requestUrl = "https://app.example.test/api/webhooks/meta/whatsapp";
const appSecret = "meta-app-secret-for-http-tests";
const verifyToken = "meta-verify-token-for-http-tests";

describe("point d'entrée HTTP WhatsApp Cloud Meta", () => {
  it.each(["disabled", "not_configured", "awaiting_human_auth"] as const)(
    "refuse avant lecture ou réception quand le canal est %s",
    async (state) => {
      const receive = vi.fn();
      const response = await handlePreparedMetaWhatsAppWebhookRequest(
        postRequest('{"contenu":"privé"}'),
        { state, appSecret, verifyToken, receive },
      );

      expect(response.status).toBe(503);
      expect(response.headers.get("retry-after")).toBe("300");
      expect(receive).not.toHaveBeenCalled();
    },
  );

  it("valide le challenge Meta en temps constant sans remettre d'événement", async () => {
    const receive = vi.fn();
    const response = await handlePreparedMetaWhatsAppWebhookRequest(
      new Request(
        `${requestUrl}?hub.mode=subscribe&hub.verify_token=${verifyToken}&hub.challenge=challenge_123`,
      ),
      { state: "ready", appSecret, verifyToken, receive },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(await response.text()).toBe("challenge_123");
    expect(receive).not.toHaveBeenCalled();
  });

  it("refuse un challenge ambigu ou à jeton incorrect sans appeler le métier", async () => {
    const receive = vi.fn();
    const invalidToken = await handlePreparedMetaWhatsAppWebhookRequest(
      new Request(
        `${requestUrl}?hub.mode=subscribe&hub.verify_token=invalide&hub.challenge=challenge_123`,
      ),
      { state: "ready", appSecret, verifyToken, receive },
    );
    const ambiguous = await handlePreparedMetaWhatsAppWebhookRequest(
      new Request(
        `${requestUrl}?hub.mode=subscribe&hub.verify_token=${verifyToken}&hub.challenge=one&hub.challenge=two`,
      ),
      { state: "ready", appSecret, verifyToken, receive },
    );

    expect(invalidToken.status).toBe(403);
    expect(ambiguous.status).toBe(403);
    expect(receive).not.toHaveBeenCalled();
  });

  it("transmet exactement le JSON brut et la signature après les gardes HTTP", async () => {
    const rawBody = '{ "entry" : [ { "id" : "123" } ] }';
    const receive = vi.fn().mockResolvedValue({ accepted: true });
    const response = await handlePreparedMetaWhatsAppWebhookRequest(
      postRequest(rawBody, { "x-hub-signature-256": "sha256=test" }),
      { state: "ready", appSecret, verifyToken, receive },
    );

    expect(receive).toHaveBeenCalledWith({
      rawBody,
      signature: "sha256=test",
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("refuse le type, la taille, l'UTF-8 et le secret absents avant réception", async () => {
    const receive = vi.fn();
    const wrongType = await handlePreparedMetaWhatsAppWebhookRequest(
      postRequest("texte", { "content-type": "text/plain" }),
      { state: "ready", appSecret, verifyToken, receive },
    );
    const oversized = await handlePreparedMetaWhatsAppWebhookRequest(
      postRequest("{}", { "content-length": String(512 * 1024 + 1) }),
      { state: "ready", appSecret, verifyToken, receive },
    );
    const invalidUtf8 = await handlePreparedMetaWhatsAppWebhookRequest(
      new Request(requestUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: new Uint8Array([0xc3, 0x28]),
      }),
      { state: "ready", appSecret, verifyToken, receive },
    );
    const missingSecret = await handlePreparedMetaWhatsAppWebhookRequest(
      postRequest("{}"),
      { state: "ready", appSecret: undefined, verifyToken, receive },
    );

    expect(wrongType.status).toBe(415);
    expect(oversized.status).toBe(413);
    expect(invalidUtf8.status).toBe(400);
    expect(missingSecret.status).toBe(503);
    expect(receive).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid_signature", 401],
    ["payload_too_large", 413],
    ["not_configured", 503],
    ["channel_provider_endpoint_not_found", 503],
    ["whatsapp_payload_invalid", 400],
  ] as const)("normalise %s sans exposer la cause interne", async (code, status) => {
    const privateBody = '{"contenu":"privé"}';
    const response = await handlePreparedMetaWhatsAppWebhookRequest(
      postRequest(privateBody),
      {
        state: "ready",
        appSecret,
        verifyToken,
        receive: () => ({ accepted: false, code }),
      },
    );
    const body = await response.text();

    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).not.toContain(code);
    expect(body).not.toContain(privateBody);
    if (code === "channel_provider_endpoint_not_found") {
      expect(response.headers.get("retry-after")).toBe("60");
    }
  });
});

function postRequest(body: string, extraHeaders: Record<string, string> = {}) {
  return new Request(requestUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...extraHeaders,
    },
    body,
  });
}
