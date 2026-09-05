import { afterEach, describe, expect, it, vi } from "vitest";
import {
  channelAdapterManifestSchema,
  describeMetaWhatsAppActivation,
  getPreparedChannelProvider,
  type ChannelAdapterState,
  type MetaWhatsAppTenantReadiness,
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
        metaTenantReadiness("ready"),
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

    const serialized = JSON.stringify(
      describeMetaWhatsAppActivation(
        manifest,
        metaTenantReadiness("credentials_missing"),
      ),
    );

    expect(serialized).not.toContain("META_WHATSAPP");
    expect(serialized).not.toContain("CHANNEL_PROVIDER_SECRET");
    expect(serialized).not.toContain(sensitiveValue);
  });

  it("refuse le manifeste d’un autre fournisseur", () => {
    expect(() =>
      describeMetaWhatsAppActivation(
        getPreparedChannelProvider("whatsapp_twilio", {}),
        metaTenantReadiness("ready"),
      ),
    ).toThrow(/manifeste whatsapp_meta/i);
  });

  it.each([
    ["ready", "not_registered", "Canal non relié"],
    ["ready", "disabled", "Canal suspendu"],
    ["ready", "credentials_missing", "Accès sécurisé manquant"],
    ["mock", "not_registered", "Canal non relié"],
    ["mock", "disabled", "Canal suspendu"],
    ["mock", "credentials_missing", "Accès sécurisé manquant"],
  ] as const)(
    "bloque un serveur %s quand l’organisation est %s",
    (serverState, tenantState, tenantStatusLabel) => {
      const checkpoint = describeMetaWhatsAppActivation(
        metaManifestWithState(serverState),
        metaTenantReadiness(tenantState),
      );

      expect(checkpoint).toMatchObject({
        state: serverState,
        tenantState,
        statusLabel: tenantStatusLabel,
        tenantStatusLabel,
        externalEffect: "blocked",
        externalEffectLabel: "Effet externe bloqué",
      });
      expect(checkpoint.summary).toMatch(/aucun message externe/i);
    },
  );

  it("distingue les états serveur et organisation sans identifiant technique", () => {
    const checkpoint = describeMetaWhatsAppActivation(
      metaManifestWithState("awaiting_human_auth"),
      metaTenantReadiness("ready"),
    );

    expect(checkpoint).toMatchObject({
      statusLabel: "Validation humaine requise",
      serverStatusLabel: "Validation humaine requise",
      tenantStatusLabel: "Organisation prête",
      tenantState: "ready",
      externalEffect: "blocked",
    });
    expect(JSON.stringify(checkpoint)).not.toMatch(
      /endpointId|externalAccountId|secretVersion/i,
    );
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

function metaTenantReadiness(
  state: MetaWhatsAppTenantReadiness["state"],
): MetaWhatsAppTenantReadiness {
  if (state === "ready") {
    return {
      provider: "whatsapp_meta",
      state,
      checks: { endpoint: "active", credentials: "active" },
    };
  }
  if (state === "credentials_missing") {
    return {
      provider: "whatsapp_meta",
      state,
      checks: { endpoint: "active", credentials: "missing" },
    };
  }
  if (state === "disabled") {
    return {
      provider: "whatsapp_meta",
      state,
      checks: { endpoint: "disabled", credentials: "not_checked" },
    };
  }
  return {
    provider: "whatsapp_meta",
    state,
    checks: { endpoint: "missing", credentials: "not_checked" },
  };
}
