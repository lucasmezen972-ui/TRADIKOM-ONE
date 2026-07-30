import { Webhook } from "svix";
import { describe, expect, it } from "vitest";
import { verifyResendWebhook } from "../src/modules/email/resend-webhook";

const signingSecret = "whsec_dHJhZGlrb20tb25lLXdlYmhvb2stdGVzdA==";

function signedInput(
  payload: Record<string, unknown>,
  options: { id?: string; timestamp?: Date } = {},
) {
  const rawBody = JSON.stringify(payload);
  const id = options.id ?? "msg_webhook_123";
  const timestamp = options.timestamp ?? new Date();
  const signature = new Webhook(signingSecret).sign(id, timestamp, rawBody);

  return {
    rawBody,
    headers: {
      id,
      timestamp: String(Math.floor(timestamp.getTime() / 1_000)),
      signature,
    },
  };
}

function providerPayload(
  type = "email.delivered",
  tags: Record<string, string> = {
    tradikom_tenant: "tenant_resend_test",
    tradikom_kind: "team_invitation",
  },
) {
  return {
    type,
    created_at: "2026-07-30T15:40:00.000Z",
    data: {
      email_id: "email_provider_123",
      from: "TRADIKOM <contact@example.test>",
      to: ["destinataire-prive@example.test"],
      subject: "Sujet privé",
      tags,
      bounce: { message: "Détail fournisseur privé" },
    },
  };
}

describe("webhook Resend préparé", () => {
  it("vérifie le corps brut puis ne retourne que l'événement sûr", () => {
    const result = verifyResendWebhook(
      signedInput(providerPayload()),
      signingSecret,
    );

    expect(result).toEqual({
      ok: true,
      event: {
        externalEventId: "msg_webhook_123",
        tenantId: "tenant_resend_test",
        providerEmailId: "email_provider_123",
        eventType: "email.delivered",
        deliveryStatus: "delivered",
        occurredAt: "2026-07-30T15:40:00.000Z",
      },
    });
    expect(JSON.stringify(result)).not.toContain("destinataire-prive");
    expect(JSON.stringify(result)).not.toContain("Sujet privé");
    expect(JSON.stringify(result)).not.toContain("Détail fournisseur");
  });

  it("refuse toute modification du corps après signature", () => {
    const input = signedInput(providerPayload());
    input.rawBody = `${input.rawBody} `;

    expect(verifyResendWebhook(input, signingSecret)).toEqual({
      ok: false,
      code: "invalid_signature",
    });
  });

  it("refuse un timestamp expiré via la bibliothèque officielle", () => {
    const input = signedInput(providerPayload(), {
      timestamp: new Date(Date.now() - 6 * 60 * 1_000),
    });
    expect(verifyResendWebhook(input, signingSecret)).toEqual({
      ok: false,
      code: "invalid_signature",
    });
  });

  it("refuse avant parsing si le secret, les en-têtes ou la taille manquent", () => {
    const valid = signedInput(providerPayload());
    expect(verifyResendWebhook(valid, undefined)).toEqual({
      ok: false,
      code: "not_configured",
    });
    expect(
      verifyResendWebhook(
        { rawBody: valid.rawBody, headers: { id: valid.headers.id } },
        signingSecret,
      ),
    ).toEqual({ ok: false, code: "invalid_headers" });
    expect(
      verifyResendWebhook(
        {
          ...valid,
          rawBody: "é".repeat(512 * 1024),
        },
        signingSecret,
      ),
    ).toEqual({ ok: false, code: "payload_too_large" });
  });

  it("refuse les événements non nécessaires et sans mapping tenant", () => {
    expect(
      verifyResendWebhook(
        signedInput(providerPayload("email.opened")),
        signingSecret,
      ),
    ).toEqual({ ok: false, code: "unsupported_event" });

    expect(
      verifyResendWebhook(
        signedInput(providerPayload("email.bounced", {})),
        signingSecret,
      ),
    ).toEqual({ ok: false, code: "tenant_mapping_missing" });
  });

  it.each([
    ["email.sent", "sent"],
    ["email.delivered", "delivered"],
    ["email.delivery_delayed", "delayed"],
    ["email.bounced", "failed"],
    ["email.complained", "failed"],
    ["email.failed", "failed"],
    ["email.suppressed", "failed"],
  ] as const)("normalise %s vers %s", (eventType, expectedStatus) => {
    const result = verifyResendWebhook(
      signedInput(providerPayload(eventType)),
      signingSecret,
    );
    expect(result).toMatchObject({
      ok: true,
      event: { deliveryStatus: expectedStatus },
    });
  });
});
