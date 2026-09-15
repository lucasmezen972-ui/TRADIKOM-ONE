import type { Role } from "@/lib/types";
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
  trialAuthorizationState: MetaWhatsAppTenantReadiness["checks"]["trialAuthorization"];
  statusLabel: string;
  serverStatusLabel: string;
  tenantStatusLabel: string;
  trialAuthorizationStatusLabel: string;
  summary: string;
  tenantSummary: string;
  trialAuthorizationSummary: string;
  nextAction: string;
  externalEffectLabel: string;
  externalEffect: "blocked" | "mock" | "possible";
};

export type MetaWhatsAppTrialManagementAction = "authorize" | "revoke" | null;

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
  const trialAuthorizationPresentation =
    trialAuthorizationPresentations[tenantReadiness.checks.trialAuthorization];
  const tenantBlocksAvailableServer =
    (manifest.state === "mock" || manifest.state === "ready") &&
    tenantReadiness.state !== "ready";
  const trialAuthorizationBlocksAvailableServer =
    manifest.state === "ready" &&
    tenantReadiness.state === "ready" &&
    tenantReadiness.checks.trialAuthorization !== "valid";
  const presentation = tenantBlocksAvailableServer
    ? {
        statusLabel: tenantPresentation.statusLabel,
        summary:
          "Le mode Meta du serveur est disponible, mais la préparation de cette organisation est incomplète. Aucun message externe ne peut partir.",
        nextAction: tenantPresentation.nextAction,
        externalEffectLabel: "Effet externe bloqué",
        externalEffect: "blocked" as const,
      }
    : trialAuthorizationBlocksAvailableServer
      ? {
          statusLabel: trialAuthorizationPresentation.statusLabel,
          summary: trialAuthorizationPresentation.blockingSummary,
          nextAction: trialAuthorizationPresentation.nextAction,
          externalEffectLabel: "Effet externe bloqué",
          externalEffect: "blocked" as const,
        }
    : serverPresentation;
  return {
    provider: manifest.provider,
    displayName: manifest.displayName,
    state: manifest.state,
    tenantState: tenantReadiness.state,
    trialAuthorizationState: tenantReadiness.checks.trialAuthorization,
    serverStatusLabel: serverPresentation.statusLabel,
    tenantStatusLabel: tenantPresentation.statusLabel,
    tenantSummary: tenantPresentation.summary,
    trialAuthorizationStatusLabel: trialAuthorizationPresentation.statusLabel,
    trialAuthorizationSummary: trialAuthorizationPresentation.summary,
    ...presentation,
  };
}

export function resolveMetaWhatsAppTrialManagementAction(
  checkpoint: ChannelActivationCheckpoint,
  role: Role,
): MetaWhatsAppTrialManagementAction {
  if (!(["owner", "administrator"] as Role[]).includes(role)) {
    return null;
  }
  if (checkpoint.trialAuthorizationState === "valid") return "revoke";
  if (
    checkpoint.tenantState === "ready" &&
    checkpoint.trialAuthorizationState === "required"
  ) {
    return "authorize";
  }
  return null;
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
  ambiguous: {
    statusLabel: "Configuration à clarifier",
    summary:
      "Plusieurs canaux WhatsApp Meta actifs sont configurés pour cette organisation.",
    nextAction:
      "Conserver un seul canal Meta actif et configuré avant de gérer l’autorisation d’essai.",
  },
  ready: {
    statusLabel: "Canal configuré",
    summary:
      "Une configuration active et ses accès sécurisés sont enregistrés pour cette organisation.",
    nextAction:
      "Vérifier la validation humaine et demander une autorisation distincte avant tout envoi.",
  },
};

const trialAuthorizationPresentations: Record<
  MetaWhatsAppTenantReadiness["checks"]["trialAuthorization"],
  {
    statusLabel: string;
    summary: string;
    blockingSummary: string;
    nextAction: string;
  }
> = {
  not_checked: {
    statusLabel: "Non vérifiée",
    summary: "La configuration du canal doit d’abord être complète.",
    blockingSummary:
      "La configuration du canal doit d’abord être complète. Aucun message externe ne peut partir.",
    nextAction: "Finaliser d’abord la configuration sécurisée de cette organisation.",
  },
  required: {
    statusLabel: "Autorisation d’essai requise",
    summary: "Aucun essai Meta n’est autorisé pour cette organisation.",
    blockingSummary:
      "Le canal est configuré, mais aucun essai Meta n’est autorisé pour cette organisation. Aucun message externe ne peut partir.",
    nextAction:
      "Créer une autorisation d’essai distincte, limitée à un message, depuis un flux administratif contrôlé.",
  },
  valid: {
    statusLabel: "Autorisation d’essai valide",
    summary:
      "Un message d’essai reste autorisé. Aucun envoi n’est déclenché depuis cet écran.",
    blockingSummary:
      "Un message d’essai reste autorisé. Aucun envoi n’est déclenché depuis cet écran.",
    nextAction:
      "Conserver cette autorisation pour l’essai explicitement prévu, sans envoi automatique.",
  },
  exhausted: {
    statusLabel: "Autorisation d’essai épuisée",
    summary:
      "Le message d’essai autorisé a déjà été consommé. Aucun autre envoi n’est permis.",
    blockingSummary:
      "L’autorisation d’essai Meta est épuisée. Aucun autre message externe ne peut partir.",
    nextAction:
      "Examiner la preuve du premier essai avant toute nouvelle autorisation distincte.",
  },
};
