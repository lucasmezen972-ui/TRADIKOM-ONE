import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyAndPrepareSlackWebhook } from "../src/modules/channels";

const signingSecret = "slack-test-signing-secret-32-bytes";
const requestTimestamp = "1800000000";

describe("vérification webhook Slack v0", () => {
  it("vérifie le corps brut avant de projeter un message borné", () => {
    const privateFileUrl = "https://files.slack.com/files-pri/private";
    const rawBody = JSON.stringify(
      eventPayload({
        event: {
          ...eventPayload().event,
          files: [{ url_private: privateFileUrl, name: "confidentiel.pdf" }],
        },
        extra_private_payload: { secret: "ne pas propager" },
      }),
    );
    const result = verifyAndPrepareSlackWebhook(
      signedInput(rawBody),
      { signingSecret, nowEpochSeconds: Number(requestTimestamp) },
    );

    expect(result).toMatchObject({
      ok: true,
      kind: "event",
      message: {
        provider: "slack",
        adapterKey: "slack",
        externalEventId: "Ev123ABC456",
        appId: "A123ABC456",
        workspaceId: "T123ABC456",
        senderSubject: "U123ABC456",
        conversationSubject: "D123ABC456",
        text: "Bonjour depuis Slack",
        attachmentCount: 1,
        receivedAt: "2027-01-15T08:00:00.123Z",
      },
    });
    expect(JSON.stringify(result)).not.toContain(privateFileUrl);
    expect(JSON.stringify(result)).not.toContain("confidentiel.pdf");
    expect(JSON.stringify(result)).not.toContain("extra_private_payload");
  });

  it("refuse une signature altérée avant de parser le JSON", () => {
    const result = verifyAndPrepareSlackWebhook(
      {
        rawBody: "{json volontairement invalide",
        signature: `v0=${"a".repeat(64)}`,
        requestTimestamp,
      },
      { signingSecret, nowEpochSeconds: Number(requestTimestamp) },
    );

    expect(result).toEqual({ ok: false, code: "invalid_signature" });
  });

  it("refuse les timestamps hors fenêtre anti-rejeu de cinq minutes", () => {
    const rawBody = JSON.stringify(eventPayload());
    const result = verifyAndPrepareSlackWebhook(signedInput(rawBody), {
      signingSecret,
      nowEpochSeconds: Number(requestTimestamp) + 301,
    });

    expect(result).toEqual({ ok: false, code: "replay_window_exceeded" });
  });

  it("refuse un événement daté dans le futur au-delà de la tolérance", () => {
    const rawBody = JSON.stringify(
      eventPayload({
        event: {
          ...eventPayload().event,
          ts: "1800000301.000000",
        },
      }),
    );
    const result = verifyAndPrepareSlackWebhook(signedInput(rawBody), {
      signingSecret,
      nowEpochSeconds: Number(requestTimestamp),
    });

    expect(result).toEqual({ ok: false, code: "invalid_payload" });
  });

  it("ignore les messages de bot ou sous-types après signature", () => {
    const rawBody = JSON.stringify(
      eventPayload({
        event: {
          ...eventPayload().event,
          subtype: "bot_message",
          bot_id: "B123ABC456",
        },
      }),
    );
    const result = verifyAndPrepareSlackWebhook(signedInput(rawBody), {
      signingSecret,
      nowEpochSeconds: Number(requestTimestamp),
    });

    expect(result).toEqual({ ok: false, code: "unsupported_event" });
  });

  it("accepte le challenge URL uniquement après signature", () => {
    const rawBody = JSON.stringify({
      type: "url_verification",
      challenge: "challenge-slack-sûr",
      token: "ancien-token-à-ignorer",
    });
    const result = verifyAndPrepareSlackWebhook(signedInput(rawBody), {
      signingSecret,
      nowEpochSeconds: Number(requestTimestamp),
    });

    expect(result).toEqual({
      ok: true,
      kind: "url_verification",
      challenge: "challenge-slack-sûr",
    });
    expect(JSON.stringify(result)).not.toContain("ancien-token");
  });

  it("borne le corps selon ses octets UTF-8", () => {
    const result = verifyAndPrepareSlackWebhook(
      {
        rawBody: "é".repeat(1024 * 1024),
        signature: `v0=${"a".repeat(64)}`,
        requestTimestamp,
      },
      { signingSecret, nowEpochSeconds: Number(requestTimestamp) },
    );

    expect(result).toEqual({ ok: false, code: "payload_too_large" });
  });
});

function signedInput(rawBody: string) {
  return {
    rawBody,
    requestTimestamp,
    signature: `v0=${createHmac("sha256", signingSecret)
      .update(`v0:${requestTimestamp}:${rawBody}`)
      .digest("hex")}`,
  };
}

function eventPayload(overrides: Record<string, unknown> = {}) {
  return {
    type: "event_callback",
    team_id: "T123ABC456",
    api_app_id: "A123ABC456",
    event_id: "Ev123ABC456",
    event_time: 1_800_000_000,
    event: {
      type: "message",
      user: "U123ABC456",
      channel: "D123ABC456",
      channel_type: "im",
      text: " Bonjour depuis Slack ",
      ts: "1800000000.123456",
    },
    ...overrides,
  };
}
