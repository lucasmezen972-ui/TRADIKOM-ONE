import { afterEach, describe, expect, it, vi } from "vitest";
import {
  channelAdapterManifestSchema,
  describeMetaWhatsAppActivation,
  getPreparedChannelProvider,
  type ChannelAdapterState,
} from "../src/modules/channels";

describe("point de contrôle d’activation Meta dans Conversation", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ["disabled", "Désactivé", "Effet externe bloqué", "blocked"],
    [
      "not_configured",
      "Configuration requise",
      "Effet externe bloqué",
      "blocked",
    ],
    [
      "awaiting_human_auth",
      "Validation humaine requise",
      "Effet externe bloqué",
      "blocked",
    ],
    ["mock", "Simulation", "Effet simulé uniquement", "mock"],
    [
      "ready",
      "Prêt techniquement",
      "Effet externe possible après autorisation",
      "possible",
    ],
  ] as const)(
    "présente l’état %s sans déclencher le réseau",
    (state, statusLabel, externalEffectLabel, externalEffect) => {
      const fetchSpy = vi.spyOn(globalThis, "fetch");
      const checkpoint = describeMetaWhatsAppActivation(
        metaManifestWithState(state),
      );

      expect(checkpoint).toMatchObject({
        provider: "whatsapp_meta",
        state,
        statusLabel,
        externalEffectLabel,
        externalEffect,
      });
      expect(checkpoint.summary).toMatch(/message/i);
      expect(checkpoint.nextAction.length).toBeGreaterThan(20);
      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  it("ne projette ni noms de configuration ni valeurs sensibles", () => {
    const sensitiveValue = "secret-value-that-must-not-be-rendered";
    const manifest = getPreparedChannelProvider("whatsapp_meta", {
      FEATURE_CHANNEL_WHATSAPP_META: "true",
      META_WHATSAPP_APP_SECRET: sensitiveValue,
    });

    const serialized = JSON.stringify(describeMetaWhatsAppActivation(manifest));

    expect(serialized).not.toContain("META_WHATSAPP");
    expect(serialized).not.toContain("CHANNEL_PROVIDER_SECRET");
    expect(serialized).not.toContain(sensitiveValue);
  });

  it("refuse le manifeste d’un autre fournisseur", () => {
    expect(() =>
      describeMetaWhatsAppActivation(
        getPreparedChannelProvider("whatsapp_twilio", {}),
      ),
    ).toThrow(/manifeste whatsapp_meta/i);
  });
});

function metaManifestWithState(state: ChannelAdapterState) {
  const base = getPreparedChannelProvider("whatsapp_meta", {});
  if (state === "disabled") return base;
  if (state === "not_configured") {
    return getPreparedChannelProvider("whatsapp_meta", {
      FEATURE_CHANNEL_WHATSAPP_META: "true",
    });
  }
  return channelAdapterManifestSchema.parse({
    ...base,
    state,
    missingEnvironment: [],
    transportEnabled: state === "mock" || state === "ready",
  });
}
