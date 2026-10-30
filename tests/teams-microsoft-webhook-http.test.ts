import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import {
  handlePreparedTeamsWebhookRequest,
  type PreparedTeamsInboundMessage,
} from "../src/modules/channels";

const clientId = "11111111-1111-4111-8111-111111111111";
const tenantId = "22222222-2222-4222-8222-222222222222";
const eventFingerprint = createHash("sha256")
  .update("activity-123")
  .digest("hex");
const preparedMessage: PreparedTeamsInboundMessage = {
  provider: "teams_microsoft",
  adapterKey: "teams-microsoft",
  externalMessageId: "activity-123",
  microsoftTenantId: tenantId,
  senderSubject: "29:sender",
  recipientSubject: "28:bot",
  conversationSubject: "19:conversation@thread.v2",
  text: "Bonjour",
  attachmentCount: 0,
  idempotencyKey: `ingress:teams_microsoft:${eventFingerprint}`,
  correlationId: `teams_${eventFingerprint}`,
  receivedAt: "2026-07-30T18:00:00.000Z",
};

describe("route Microsoft Teams préparée", () => {
  it.each(["disabled", "not_configured", "awaiting_human_auth"] as const)(
    "refuse l'état %s avant lecture, vérification et ingestion",
    async (state) => {
      const stream = new ReadableStream({
        pull: vi.fn(() => {
          throw new Error("le corps ne doit pas être lu");
        }),
      });
      const verify = vi.fn();
      const receive = vi.fn();
      const response = await handlePreparedTeamsWebhookRequest(
        new Request("https://app.example.test/api/webhooks/microsoft/teams", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: stream,
          duplex: "half",
        } as RequestInit),
        { state, clientId, tenantId, verify, receive },
      );

      expect(response.status).toBe(503);
      expect(response.headers.get("retry-after")).toBe("300");
      expect(verify).not.toHaveBeenCalled();
      expect(receive).not.toHaveBeenCalled();
    },
  );

  it("ne remet au consommateur qu'une enveloppe déjà vérifiée", async () => {
    const verify = vi.fn().mockResolvedValue({
      ok: true,
      message: preparedMessage,
    });
    const receive = vi.fn().mockResolvedValue({ accepted: true });
    const response = await handlePreparedTeamsWebhookRequest(request(), {
      state: "ready",
      clientId,
      tenantId,
      verify,
      receive,
    });

    expect(response.status).toBe(200);
    expect(receive).toHaveBeenCalledWith(preparedMessage);
    expect(await response.json()).toEqual({ ok: true });
  });

  it("refuse un JWT invalide sans appeler le consommateur", async () => {
    const receive = vi.fn();
    const response = await handlePreparedTeamsWebhookRequest(request(), {
      state: "ready",
      clientId,
      tenantId,
      verify: vi
        .fn()
        .mockResolvedValue({ ok: false, code: "invalid_authorization" }),
      receive,
    });

    expect(response.status).toBe(401);
    expect(receive).not.toHaveBeenCalled();
    expect(JSON.stringify(await response.json())).not.toContain(
      "invalid_authorization",
    );
  });

  it("acquitte une activité authentifiée mais volontairement ignorée", async () => {
    const receive = vi.fn();
    const response = await handlePreparedTeamsWebhookRequest(request(), {
      state: "ready",
      clientId,
      tenantId,
      verify: vi
        .fn()
        .mockResolvedValue({ ok: false, code: "unsupported_activity" }),
      receive,
    });

    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ ok: true, ignored: true });
    expect(receive).not.toHaveBeenCalled();
  });

  it("borne le Content-Length avant de lire le flux", async () => {
    const verify = vi.fn();
    const response = await handlePreparedTeamsWebhookRequest(
      new Request("https://app.example.test/api/webhooks/microsoft/teams", {
        method: "POST",
        headers: {
          authorization: "Bearer header.payload.signature",
          "content-type": "application/json",
          "content-length": String(1024 * 1024 + 1),
        },
        body: "{}",
      }),
      {
        state: "ready",
        clientId,
        tenantId,
        verify,
        receive: vi.fn(),
      },
    );

    expect(response.status).toBe(413);
    expect(verify).not.toHaveBeenCalled();
  });
});

function request() {
  return new Request("https://app.example.test/api/webhooks/microsoft/teams", {
    method: "POST",
    headers: {
      authorization: "Bearer header.payload.signature",
      "content-type": "application/json; charset=utf-8",
    },
    body: JSON.stringify({ type: "message" }),
  });
}
