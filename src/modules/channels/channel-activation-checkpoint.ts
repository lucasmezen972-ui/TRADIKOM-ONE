import {
  channelAdapterManifestSchema,
  type ChannelAdapterManifest,
  type ChannelAdapterState,
} from "@/modules/channels/contracts";

export type ChannelActivationCheckpoint = {
  provider: "whatsapp_meta";
  displayName: string;
  state: ChannelAdapterState;
  statusLabel: string;
  summary: string;
  nextAction: string;
  externalEffectLabel: string;
  externalEffect: "blocked" | "mock" | "possible";
};

export function describeMetaWhatsAppActivation(
  input: ChannelAdapterManifest,
): ChannelActivationCheckpoint {
  const manifest = channelAdapterManifestSchema.parse(input);
  if (manifest.provider !== "whatsapp_meta") {
    throw new Error(
      "Le point de contrôle Meta exige le manifeste whatsapp_meta.",
    );
  }

  const presentation = presentations[manifest.state];
  return {
    provider: manifest.provider,
    displayName: manifest.displayName,
    state: manifest.state,
    ...presentation,
  };
}

const presentations: Record<
  ChannelAdapterState,
  Omit<
    ChannelActivationCheckpoint,
    "provider" | "displayName" | "state"
  >
> = {
  disabled: {
    statusLabel: "Désactivé",
    summary:
      "Le connecteur Meta est désactivé sur ce serveur. Aucun message externe ne peut partir.",
    nextAction:
      "Conserver cet état ou demander une activation dans un environnement contrôlé.",
    externalEffectLabel: "Effet externe bloqué",
    externalEffect: "blocked",
  },
  not_configured: {
    statusLabel: "Configuration requise",
    summary:
      "Le connecteur Meta est activé, mais sa configuration sécurisée reste incomplète. Aucun message externe ne peut partir.",
    nextAction:
      "Terminer la configuration côté serveur, sans saisir de secret dans cette interface.",
    externalEffectLabel: "Effet externe bloqué",
    externalEffect: "blocked",
  },
  awaiting_human_auth: {
    statusLabel: "Validation humaine requise",
    summary:
      "La préparation technique est présente, mais Meta attend encore une validation humaine. Aucun message externe ne peut partir.",
    nextAction:
      "Finaliser la validation dans Meta, puis revenir confirmer l’activation avant tout envoi.",
    externalEffectLabel: "Effet externe bloqué",
    externalEffect: "blocked",
  },
  mock: {
    statusLabel: "Simulation",
    summary:
      "Le connecteur fonctionne uniquement en simulation locale. Aucun message externe ne part.",
    nextAction:
      "Conserver le mock ou préparer un test sandbox explicitement autorisé.",
    externalEffectLabel: "Effet simulé uniquement",
    externalEffect: "mock",
  },
  ready: {
    statusLabel: "Prêt techniquement",
    summary:
      "Le transport Meta est techniquement prêt. Aucun message ne part automatiquement.",
    nextAction:
      "Vérifier l’endpoint de cette organisation et obtenir l’autorisation d’envoi dans le périmètre prévu.",
    externalEffectLabel: "Effet externe possible après autorisation",
    externalEffect: "possible",
  },
};
