import { afterEach, describe, expect, it, vi } from "vitest";
import { createRuntimeEmailProvider } from "../src/modules/email/providers";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("sélection sûre du provider email", () => {
  it("utilise la console uniquement hors production", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("EMAIL_PROVIDER", "console");

    const provider = createRuntimeEmailProvider();
    expect(provider.name).toBe("console");
  });

  it("refuse toujours la console en production", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("EMAIL_PROVIDER", "console");

    const provider = createRuntimeEmailProvider();
    expect(provider.name).toBe("unavailable");
    await expect(provider.send(sampleMessage())).resolves.toMatchObject({
      status: "retryable_failure",
      errorCode: "provider_not_configured",
    });
  });

  it("ne transforme jamais une sélection Resend en fausse livraison console", async () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("EMAIL_PROVIDER", "resend");
    vi.stubEnv("FEATURE_CHANNEL_EMAIL", "true");
    vi.stubEnv("RESEND_API_KEY", "clé-présente-mais-non-autorisée");
    vi.stubEnv("EMAIL_FROM", "contact@example.test");
    vi.stubEnv("RESEND_WEBHOOK_SECRET", "secret-présent");
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const provider = createRuntimeEmailProvider();
    expect(provider.name).toBe("unavailable");
    await provider.send(sampleMessage());
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

function sampleMessage() {
  return {
    kind: "password_reset" as const,
    to: "destinataire@example.test",
    subject: "Réinitialisation",
    text: "Lien de test",
    html: "<p>Lien de test</p>",
    metadata: { expiresAt: "2026-08-01T10:00:00.000Z" },
  };
}
