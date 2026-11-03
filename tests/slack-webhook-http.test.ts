import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import {
  handlePreparedSlackWebhookRequest,
  type PreparedSlackInboundMessage,
} from "../src/modules/channels";

const eventFingerprint = createHash("sha256")
  .update("Ev123ABC456")
  .digest("hex");
const preparedMessage: PreparedSlackInboundMessage = {
  provider: "slack",
  adapterKey: "slack",
  externalEventId: "Ev123ABC456",
  appId: "A123ABC456",
  workspaceId: "T123ABC456",
  senderSubject: "U123ABC456",
  conversationSubject: "D123ABC456",
  text: "Bonjour Slack",
  attachmentCount: 0,
  idempotencyKey: `ingress:slack:${eventFingerprint}`,
  correlationId: `slack_${eventFingerprint}`,
  receivedAt: "2027-01-15T08:00:00.123Z",
};

describe("route Slack préparée", () => {
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
      const response = await handlePreparedSlackWebhookRequest(
        new Request("https://app.example.test/api/webhooks/slack", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: stream,
          duplex: "half",
        } as RequestInit),
        {
          state,
          signingSecret: "unused",
          verify,
          receive,
        },
      );

      expect(response.status).toBe(503);
      expect(verify).not.toHaveBeenCalled();
      expect(receive).not.toHaveBeenCalled();
    },
  );

  it("ne remet au consommateur qu'un événement déjà vérifié", async () => {
    const receive = vi.fn().mockResolvedValue({ accepted: true });
    const response = await handlePreparedSlackWebhookRequest(request(), {
      state: "ready",
      signingSecret: "slack-test-signing-secret-32-bytes",
      verify: vi.fn().mockReturnValue({
        ok: true,
        kind: "event",
        message: preparedMessage,
      }),
      receive,
    });

    expect(response.status).toBe(200);
    expect(receive).toHaveBeenCalledWith(preparedMessage);
  });

  it("refuse une signature ou un replay sans appeler le consommateur", async () => {
    const receive = vi.fn();
    for (const code of ["invalid_signature", "replay_window_exceeded"] as const) {
      const response = await handlePreparedSlackWebhookRequest(request(), {
        state: "ready",
        signingSecret: "slack-test-signing-secret-32-bytes",
        verify: vi.fn().mockReturnValue({ ok: false, code }),
        receive,
      });
      expect(response.status).toBe(401);
    }
    expect(receive).not.toHaveBeenCalled();
  });

  it("retourne le challenge signé sans atteindre le métier", async () => {
    const receive = vi.fn();
    const response = await handlePreparedSlackWebhookRequest(request(), {
      state: "ready",
      signingSecret: "slack-test-signing-secret-32-bytes",
      verify: vi.fn().mockReturnValue({
        ok: true,
        kind: "url_verification",
        challenge: "challenge-slack-sûr",
      }),
      receive,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ challenge: "challenge-slack-sûr" });
    expect(receive).not.toHaveBeenCalled();
  });

  it("borne la taille déclarée avant lecture", async () => {
    const verify = vi.fn();
    const response = await handlePreparedSlackWebhookRequest(
      new Request("https://app.example.test/api/webhooks/slack", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "content-length": String(1024 * 1024 + 1),
        },
        body: "{}",
      }),
      {
        state: "ready",
        signingSecret: "slack-test-signing-secret-32-bytes",
        verify,
        receive: vi.fn(),
      },
    );

    expect(response.status).toBe(413);
    expect(verify).not.toHaveBeenCalled();
  });
});

function request() {
  return new Request("https://app.example.test/api/webhooks/slack", {
    method: "POST",
    headers: { "content-type": "application/json; charset=utf-8" },
    body: "{}",
  });
}
