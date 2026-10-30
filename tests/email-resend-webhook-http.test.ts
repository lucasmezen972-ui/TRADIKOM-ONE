import { describe, expect, it, vi } from "vitest";
import { handlePreparedResendWebhookRequest } from "../src/modules/email";

const url = "https://app.tradikom.test/api/webhooks/resend";
const webhookHeaders = {
  "content-type": "application/json",
  "svix-id": "msg_http_123",
  "svix-timestamp": "1785429000",
  "svix-signature": "v1,signature",
};

describe("point d'entrée HTTP Resend préparé", () => {
  it.each(["disabled", "not_configured", "awaiting_human_auth"] as const)(
    "refuse sans lire le fournisseur quand le canal est %s",
    async (state) => {
      const receive = vi.fn();
      const response = await handlePreparedResendWebhookRequest(
        new Request(url, {
          method: "POST",
          headers: webhookHeaders,
          body: JSON.stringify({ private: "ne pas lire" }),
        }),
        { state, receive },
      );

      expect(response.status).toBe(503);
      expect(response.headers.get("retry-after")).toBe("300");
      expect(receive).not.toHaveBeenCalled();
    },
  );

  it("transmet exactement le corps brut et les en-têtes Svix en état prêt injecté", async () => {
    const rawBody = JSON.stringify({
      type: "email.delivered",
      data: { to: ["adresse-privee@example.test"] },
    });
    const receive = vi.fn().mockResolvedValue({ accepted: true });
    const response = await handlePreparedResendWebhookRequest(
      new Request(url, {
        method: "POST",
        headers: webhookHeaders,
        body: rawBody,
      }),
      { state: "ready", receive },
    );

    expect(receive).toHaveBeenCalledWith({
      rawBody,
      headers: {
        id: "msg_http_123",
        timestamp: "1785429000",
        signature: "v1,signature",
      },
    });
    expect(response.status).toBe(200);
    const responseBody = await response.text();
    expect(JSON.parse(responseBody)).toEqual({ ok: true });
    expect(responseBody).not.toContain("adresse-privee");
  });

  it("borne le corps avant ingestion et refuse un type non JSON", async () => {
    const receive = vi.fn();
    const oversized = await handlePreparedResendWebhookRequest(
      new Request(url, {
        method: "POST",
        headers: {
          ...webhookHeaders,
          "content-length": String(512 * 1024 + 1),
        },
        body: "{}",
      }),
      { state: "ready", receive },
    );
    const wrongType = await handlePreparedResendWebhookRequest(
      new Request(url, {
        method: "POST",
        headers: { ...webhookHeaders, "content-type": "text/plain" },
        body: "{}",
      }),
      { state: "ready", receive },
    );
    const oversizedStream = await handlePreparedResendWebhookRequest(
      new Request(url, {
        method: "POST",
        headers: webhookHeaders,
        body: "é".repeat(300 * 1024),
      }),
      { state: "ready", receive },
    );

    expect(oversized.status).toBe(413);
    expect(oversizedStream.status).toBe(413);
    expect(wrongType.status).toBe(415);
    expect(receive).not.toHaveBeenCalled();
  });

  it("acquitte les événements ignorés et réessaie un mapping encore absent", async () => {
    const ignored = await handlePreparedResendWebhookRequest(
      request(),
      {
        state: "ready",
        receive: async () => ({
          accepted: false,
          code: "unsupported_event",
        }),
      },
    );
    const unmapped = await handlePreparedResendWebhookRequest(
      request(),
      {
        state: "ready",
        receive: async () => ({
          accepted: false,
          code: "email_provider_delivery_not_found",
        }),
      },
    );

    expect(ignored.status).toBe(200);
    expect(await ignored.json()).toEqual({ ok: true, ignored: true });
    expect(unmapped.status).toBe(503);
    expect(unmapped.headers.get("retry-after")).toBe("60");
  });

  it.each([
    ["invalid_signature", 401],
    ["invalid_headers", 401],
    ["payload_too_large", 413],
    ["email_provider_event_conflict", 409],
    ["payload_invalid", 400],
  ] as const)("normalise %s sans exposer le code interne", async (code, status) => {
    const response = await handlePreparedResendWebhookRequest(request(), {
      state: "ready",
      receive: async () => ({ accepted: false, code }),
    });
    const body = await response.text();

    expect(response.status).toBe(status);
    expect(body).not.toContain(code);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});

function request() {
  return new Request(url, {
    method: "POST",
    headers: webhookHeaders,
    body: "{}",
  });
}
