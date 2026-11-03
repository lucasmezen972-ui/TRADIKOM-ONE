import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { verifyMetaWhatsAppWebhook } from "../src/modules/channels";

const appSecret = "meta_app_secret_for_tests_only_123456789";
const rawBody = '{"object":"whatsapp_business_account","entry":[]}';

function signatureFor(body = rawBody) {
  return `sha256=${createHmac("sha256", appSecret).update(body).digest("hex")}`;
}

describe("vérification WhatsApp Cloud API Meta", () => {
  it("valide la signature du corps brut sans appel réseau", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = verifyMetaWhatsAppWebhook(
      { rawBody, signature: signatureFor() },
      appSecret,
    );

    expect(result).toEqual({
      ok: true,
      event: { signatureVerified: true, payloadBytes: Buffer.byteLength(rawBody) },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuse avant parsing quand le secret ou la signature manque", () => {
    expect(verifyMetaWhatsAppWebhook({ rawBody, signature: signatureFor() }, undefined)).toEqual({
      ok: false,
      code: "not_configured",
    });
    expect(verifyMetaWhatsAppWebhook({ rawBody, signature: "sha256=abc" }, appSecret)).toEqual({
      ok: false,
      code: "invalid_signature",
    });
  });

  it("refuse une altération ou un corps hors limite", () => {
    expect(verifyMetaWhatsAppWebhook({ rawBody: `${rawBody} `, signature: signatureFor() }, appSecret)).toEqual({
      ok: false,
      code: "invalid_signature",
    });
    expect(verifyMetaWhatsAppWebhook({ rawBody: "x".repeat(512 * 1024 + 1), signature: signatureFor("x".repeat(512 * 1024 + 1)) }, appSecret)).toEqual({
      ok: false,
      code: "payload_too_large",
    });
  });
});
