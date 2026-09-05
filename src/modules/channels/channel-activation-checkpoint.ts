import {
  channelAdapterManifestSchema,
  type ChannelAdapterManifest,
  type ChannelAdapterState,
} from "@/modules/channels/contracts";
import type { MetaWhatsAppTenantReadiness } from "@/modules/channels/provider-endpoints-service";

export type ChannelActivationCheckpoint = {
  provider: "whatsapp_meta";
  displayName: string;
  state: ChannelAdapterState;
  tenantState: MetaWhatsAppTenantReadiness["state"];
  statusLabel: string;
  serverStatusLabel: string;
  tenantStatusLabel: string;
  summary: string;
  tenantSummary: string;
  nextAction: string;
  externalEffectLabel: string;
  externalEffect: "blocked" | "mock" | "possible";
};

type ServerPresentation = Pick<
  ChannelActivationCheckpoint,
  | "statusLabel"
  | "summary"
  | "nextAction"
  | "externalEffectLabel"
  | "externalEffect"
>;

export function describeMetaWhatsAppActivation(
  input: ChannelAdapterManifest,
  tenantReadiness: MetaWhatsAppTenantReadiness,
): ChannelActivationCheckpoint {
  const manifest = channelAdapterManifestSchema.parse(input);
  if (manifest.provider !== "whatsapp_meta") {
    throw new Error(
      "Le point de contrôle Meta exige le manifeste whatsapp_meta.",
    );
  }
  if (tenantReadiness.provider !== "whatsapp_meta") {
    throw new Error(
      "Le point de contrôle Meta exige la préparation tenant whatsapp_meta.",
    );
  }

  const serverPresentation = serverPresentations[manifest.state];
  const tenantPresentation = tenantPresentations[tenantReadiness.state];
  const tenantBlocksAvailableServer =
    (manifest.state === "mock" || manifest.state === "ready") &&
    tenantReadiness.state !== "ready";
  const presentation = tenantBlocksAvailableServer
    ? {
        statusLabel: tenantPresentation.statusLabel,
        summary:
          "Le mode Meta du serveur est disponible, mais la préparation de cette organisation est incomplète. Aucun message externe ne peut partir.",
        nextAction: tenantPresentation.nextAction,
        externalEffectLabel: "Effet externe bloqué",
        externalEffect: "blocked" as const,
      }
    : serverPresentation;
  return {
    provider: manifest.provider,
    displayName: manifest.displayName,
    state: manifest.state,
    tenantState: tenantReadiness.state,
    serverStatusLabel: serverPresentation.statusLabel,
    tenantStatusLabel: tenantPresentation.statusLabel,
    tenantSummary: tenantPresentation.summary,
    ...presentation,
  };
}

const serverPresentations: Record<ChannelAdapterState, ServerPresentation> = {
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
      "Vérifier la configuration de cette organisation et obtenir l’autorisation d’envoi dans le périmètre prévu.",
    externalEffectLabel: "Effet externe possible après autorisation",
    externalEffect: "possible",
  },
};

const tenantPresentations: Record<
  MetaWhatsAppTenantReadiness["state"],
  { statusLabel: string; summary: string; nextAction: string }
> = {
  not_registered: {
    statusLabel: "Canal non relié",
    summary:
      "Aucune configuration WhatsApp Meta n’est enregistrée pour cette organisation.",
    nextAction:
      "Relier le canal à cette organisation dans un environnement contrôlé.",
  },
  disabled: {
    statusLabel: "Canal suspendu",
    summary:
      "Une configuration WhatsApp Meta existe pour cette organisation, mais elle est désactivée.",
    nextAction:
      "Vérifier la configuration existante avant de demander sa réactivation.",
  },
  credentials_missing: {
    statusLabel: "Accès sécurisé manquant",
    summary:
      "Le canal est enregistré pour cette organisation, mais ses accès sécurisés ne sont pas disponibles.",
    nextAction:
      "Finaliser les accès dans le coffre serveur, sans saisir de secret dans cette interface.",
  },
  ready: {
    statusLabel: "Organisation prête",
    summary:
      "Une configuration active et ses accès sécurisés sont enregistrés pour cette organisation.",
    nextAction:
      "Vérifier la validation humaine et demander une autorisation distincte avant tout envoi.",
  },
};
