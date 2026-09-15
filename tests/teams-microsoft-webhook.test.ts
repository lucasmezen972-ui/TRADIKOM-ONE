import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { verifyAndPrepareTeamsActivity } from "../src/modules/channels";

const clientId = "11111111-1111-4111-8111-111111111111";
const tenantId = "22222222-2222-4222-8222-222222222222";

describe("vérification Microsoft Teams officielle préparée", () => {
  it("valide avant de projeter une enveloppe sans payload ni PII annexe", async () => {
    const check = vi.fn().mockResolvedValue({ appId: "botframework" });
    const createValidator = vi.fn(() => ({ check }));
    const activity = baseActivity({
      from: { id: "29:sender", name: "Nom personnel à écarter" },
      attachments: [
        {
          contentType: "application/vnd.microsoft.card.adaptive",
          contentUrl: "https://secret.example.test/private-document",
          content: { private: "payload à écarter" },
        },
      ],
      unknownPayload: { secret: "ne jamais propager" },
    });
    const rawBody = JSON.stringify(activity);
    const eventFingerprint = createHash("sha256")
      .update("activity-123")
      .digest("hex");

    const result = await verifyAndPrepareTeamsActivity(
      { authorization: "Bearer header.payload.signature", rawBody },
      { clientId, tenantId, createValidator },
    );

    expect(createValidator).toHaveBeenCalledWith(clientId, tenantId);
    expect(check).toHaveBeenCalledWith(
      "Bearer header.payload.signature",
      activity,
    );
    expect(result).toEqual({
      ok: true,
      message: {
        provider: "teams_microsoft",
        adapterKey: "teams-microsoft",
        externalMessageId: "activity-123",
        microsoftTenantId: tenantId,
        senderSubject: "29:sender",
        recipientSubject: "28:bot",
        conversationSubject: "19:conversation@thread.v2",
        text: "Bonjour depuis Teams",
        attachmentCount: 1,
        idempotencyKey: `ingress:teams_microsoft:${eventFingerprint}`,
        correlationId: `teams_${eventFingerprint}`,
        receivedAt: "2026-07-30T18:00:00.000Z",
      },
    });
    expect(JSON.stringify(result)).not.toContain("Nom personnel");
    expect(JSON.stringify(result)).not.toContain("secret.example.test");
    expect(JSON.stringify(result)).not.toContain("unknownPayload");
  });

  it("refuse un bearer mal formé avant de créer le validateur", async () => {
    const createValidator = vi.fn();
    const result = await verifyAndPrepareTeamsActivity(
      {
        authorization: "Basic identité:secret",
        rawBody: JSON.stringify(baseActivity()),
      },
      { clientId, tenantId, createValidator },
    );

    expect(result).toEqual({ ok: false, code: "invalid_authorization" });
    expect(createValidator).not.toHaveBeenCalled();
  });

  it("ne remet pas l'activité lorsque le validateur officiel la refuse", async () => {
    const check = vi.fn().mockRejectedValue(new Error("signature invalide"));
    const result = await verifyAndPrepareTeamsActivity(
      {
        authorization: "Bearer header.payload.signature",
        rawBody: JSON.stringify(baseActivity()),
      },
      { clientId, tenantId, createValidator: () => ({ check }) },
    );

    expect(result).toEqual({ ok: false, code: "invalid_authorization" });
  });

  it("acquitte séparément une activité valide mais non prise en charge", async () => {
    const result = await verifyAndPrepareTeamsActivity(
      {
        authorization: "Bearer header.payload.signature",
        rawBody: JSON.stringify(baseActivity({ type: "conversationUpdate" })),
      },
      {
        clientId,
        tenantId,
        createValidator: () => ({ check: vi.fn().mockResolvedValue({}) }),
      },
    );

    expect(result).toEqual({ ok: false, code: "unsupported_activity" });
  });

  it("borne le corps réel et refuse les URLs de service non sûres", async () => {
    const createValidator = vi.fn();
    const oversized = await verifyAndPrepareTeamsActivity(
      {
        authorization: "Bearer header.payload.signature",
        rawBody: "é".repeat(1024 * 1024),
      },
      { clientId, tenantId, createValidator },
    );
    const unsafeUrl = await verifyAndPrepareTeamsActivity(
      {
        authorization: "Bearer header.payload.signature",
        rawBody: JSON.stringify(
          baseActivity({ serviceUrl: "https://user:pass@example.test/path" }),
        ),
      },
      { clientId, tenantId, createValidator },
    );

    expect(oversized).toEqual({ ok: false, code: "payload_too_large" });
    expect(unsafeUrl).toEqual({ ok: false, code: "invalid_activity" });
    expect(createValidator).not.toHaveBeenCalled();
  });
});

function baseActivity(overrides: Record<string, unknown> = {}) {
  return {
    type: "message",
    id: "activity-123",
    timestamp: "2026-07-30T18:00:00.000Z",
    serviceUrl: "https://smba.trafficmanager.net/amer/",
    channelId: "msteams",
    from: { id: "29:sender" },
    recipient: { id: "28:bot" },
    conversation: { id: "19:conversation@thread.v2" },
    channelData: { tenant: { id: tenantId } },
    text: " Bonjour depuis Teams ",
    ...overrides,
  };
}
