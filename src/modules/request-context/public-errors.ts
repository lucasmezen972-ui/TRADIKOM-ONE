import { ZodError } from "zod";
import { AuthError } from "@/modules/auth";
import { ConnectorError } from "@/modules/connectors";
import { CrmError } from "@/modules/crm";
import { RateLimitError } from "@/modules/rate-limit";
import { TenantError } from "@/modules/tenants";
import { WorkflowError } from "@/modules/workflows";
import { BusinessBrainError } from "@/modules/business-brain";
import { StrategicAdvisorError } from "@/modules/strategic-advisor";
import { AutonomousMarketingError } from "@/modules/autonomous-marketing";
import { WebsiteAiError } from "@/modules/website-ai";

export type PublicError = {
  code: string;
  classification: string;
  message: string;
  status: number;
  retryAfterSeconds?: number;
};

export function toPublicError(error: unknown): PublicError {
  if (error instanceof RateLimitError) {
    return {
      code: error.code,
      classification: "rate_limit",
      message: "Trop de tentatives. Réessayez plus tard.",
      status: 429,
      retryAfterSeconds: error.retryAfterSeconds,
    };
  }

  if (error instanceof AuthError) return mapAuthError(error);
  if (error instanceof TenantError) return mapTenantError(error);
  if (error instanceof ConnectorError) return mapConnectorError(error);
  if (error instanceof CrmError) return mapCrmError(error);
  if (error instanceof WorkflowError) return mapWorkflowError(error);
  if (error instanceof BusinessBrainError) return mapBusinessBrainError(error);
  if (error instanceof StrategicAdvisorError) return mapStrategicAdvisorError(error);
  if (error instanceof AutonomousMarketingError) {
    return mapAutonomousMarketingError(error);
  }
  if (error instanceof WebsiteAiError) return mapWebsiteAiError(error);

  if (error instanceof ZodError) {
    return {
      code: "invalid_input",
      classification: "validation",
      message: "Les informations fournies sont invalides.",
      status: 400,
    };
  }

  return {
    code: "internal_error",
    classification: "internal",
    message: "Une erreur est survenue. Réessayez plus tard.",
    status: 500,
  };
}

function mapAuthError(error: AuthError): PublicError {
  switch (error.code) {
    case "invalid_credentials":
      return publicError(error.code, "auth", "Email ou mot de passe incorrect.", 401);
    case "account_exists":
      return publicError(error.code, "auth", "Un compte existe déjà avec cet email.", 409);
    case "invalid_reset_token":
      return publicError(
        error.code,
        "auth",
        "Lien de réinitialisation invalide ou expiré.",
        400,
      );
  }
}

function mapTenantError(error: TenantError): PublicError {
  if (error.code === "tenant_access_denied") {
    return publicError(error.code, "authorization", "Accès refusé.", 403);
  }
  if (error.code === "member_exists") {
    return publicError(error.code, "tenant", "Cette personne est déjà membre.", 409);
  }
  if (error.code.startsWith("invalid_invitation")) {
    return publicError(
      error.code,
      "invitation",
      "Invitation invalide ou expirée.",
      400,
    );
  }
  return publicError(
    error.code,
    "tenant",
    "Cette opération n'est pas autorisée.",
    403,
  );
}

function mapConnectorError(error: ConnectorError): PublicError {
  switch (error.code) {
    case "webhook_rate_limited":
      return {
        ...publicError(error.code, "rate_limit", "Webhook temporairement limité.", 429),
        retryAfterSeconds: error.retryAfterSeconds,
      };
    case "webhook_duplicate":
      return publicError(error.code, "webhook", "Livraison webhook déjà reçue.", 409);
    case "webhook_oversized":
      return publicError(error.code, "webhook", "Requête trop volumineuse.", 413);
    case "webhook_disabled":
      return publicError(error.code, "webhook", "Webhook refusé.", 403);
    default:
      return publicError(error.code, "webhook", "Webhook rejeté.", 400);
  }
}

function mapCrmError(error: CrmError): PublicError {
  if (error.code === "published_site_not_found") {
    return publicError(error.code, "public_form", "Site introuvable.", 404);
  }
  if (error.code === "invalid_lead_payload") {
    return publicError(
      error.code,
      "public_form",
      "La demande n'a pas pu être acceptée.",
      400,
    );
  }
  return publicError(error.code, "crm", "Opération CRM impossible.", 400);
}

function mapWorkflowError(error: WorkflowError): PublicError {
  if (
    error.code === "workflow_run_not_found" ||
    error.code === "workflow_dead_letter_not_found" ||
    error.code === "workflow_queue_event_not_found"
  ) {
    return publicError(error.code, "workflow", "Élément introuvable.", 404);
  }
  return publicError(
    error.code,
    "workflow",
    "Action d'automatisation impossible.",
    409,
  );
}

function mapBusinessBrainError(error: BusinessBrainError): PublicError {
  if (error.code === "business_brain_entry_not_found") {
    return publicError(
      error.code,
      "business_brain",
      "Information introuvable.",
      404,
    );
  }
  if (error.code === "business_brain_revision_conflict") {
    return publicError(
      error.code,
      "business_brain",
      "Cette information a déjà été modifiée.",
      409,
    );
  }
  return publicError(
    error.code,
    "business_brain",
    "La mémoire de l'entreprise est indisponible.",
    503,
  );
}

function mapStrategicAdvisorError(error: StrategicAdvisorError): PublicError {
  if (error.code === "strategic_recommendation_not_found") {
    return publicError(
      error.code,
      "strategic_advisor",
      "Recommandation introuvable.",
      404,
    );
  }
  return publicError(
    error.code,
    "strategic_advisor",
    "Cette recommandation a déjà été décidée.",
    409,
  );
}

function mapAutonomousMarketingError(error: AutonomousMarketingError): PublicError {
  if (error.code === "marketing_profile_required") {
    return publicError(
      error.code,
      "autonomous_marketing",
      "Complétez le Business Twin avant de préparer une campagne.",
      409,
    );
  }
  if (error.code === "marketing_proposal_not_found") {
    return publicError(
      error.code,
      "autonomous_marketing",
      "Proposition marketing introuvable.",
      404,
    );
  }
  return publicError(
    error.code,
    "autonomous_marketing",
    "Cette proposition marketing a déjà été modifiée.",
    409,
  );
}

function mapWebsiteAiError(error: WebsiteAiError): PublicError {
  if (error.code === "website_ai_source_required") {
    return publicError(
      error.code,
      "website_ai",
      "Un site et un Business Twin vérifiés sont nécessaires.",
      409,
    );
  }
  return publicError(
    error.code,
    "website_ai",
    "Cette proposition web n'est plus disponible.",
    409,
  );
}

function publicError(
  code: string,
  classification: string,
  message: string,
  status: number,
): PublicError {
  return { code, classification, message, status };
}
