import type { ConnectorInstallationStatus } from "@/modules/connector-execution/schemas";

export type ConnectorPolicyDenialCode =
  | "tenant_mismatch"
  | "installation_disabled"
  | "environment_not_allowed"
  | "operation_not_approved"
  | "capability_not_allowed"
  | "scope_missing"
  | "authentication_expired"
  | "authentication_revoked"
  | "connector_version_unsupported"
  | "api_version_unsupported"
  | "breaking_change_blocked"
  | "security_suspended"
  | "approval_required";

export type ConnectorPolicyContext = {
  requestedTenantId: string;
  tenantId: string;
  status: ConnectorInstallationStatus;
  environment: "mock" | "sandbox" | "production";
  requestedEnvironment: "mock" | "sandbox" | "production";
  operation: string;
  capability: "read" | "write";
  approvedOperations: string[];
  requiredScopes: string[];
  credentialScopes: string[];
  credentialExpiresAt: string | null;
  credentialRevokedAt: string | null;
  connectorVersion: string;
  apiVersion: string;
  securitySuspended: boolean;
  breakingChangeBlocked: boolean;
  now: Date;
};

export type ConnectorPolicyDecision =
  | { allowed: true }
  | { allowed: false; code: ConnectorPolicyDenialCode; message: string };

export function evaluateConnectorPolicy(
  context: ConnectorPolicyContext,
): ConnectorPolicyDecision {
  if (context.tenantId !== context.requestedTenantId) {
    return deny("tenant_mismatch", "L'organisation ne correspond pas.");
  }
  if (context.securitySuspended) {
    return deny("security_suspended", "Le connecteur est suspendu par sécurité.");
  }
  if (context.breakingChangeBlocked) {
    return deny(
      "breaking_change_blocked",
      "Une rupture de compatibilité bloque le connecteur.",
    );
  }
  if (context.status === "write_approval_required") {
    return deny("approval_required", "Une approbation est encore requise.");
  }
  if (context.status !== "read_only_enabled") {
    return deny("installation_disabled", "Le connecteur n'est pas activé.");
  }
  if (
    context.environment !== context.requestedEnvironment ||
    context.environment !== "mock"
  ) {
    return deny(
      "environment_not_allowed",
      "L'environnement demandé n'est pas autorisé.",
    );
  }
  if (context.capability !== "read") {
    return deny(
      "capability_not_allowed",
      "Les opérations d'écriture sont désactivées.",
    );
  }
  if (!context.approvedOperations.includes(context.operation)) {
    return deny(
      "operation_not_approved",
      "Cette opération n'est pas approuvée.",
    );
  }
  if (
    context.requiredScopes.some(
      (scope) => !context.credentialScopes.includes(scope),
    )
  ) {
    return deny("scope_missing", "Les accès OAuth sont insuffisants.");
  }
  if (context.credentialRevokedAt) {
    return deny("authentication_revoked", "Les accès OAuth ont été révoqués.");
  }
  if (
    !context.credentialExpiresAt ||
    new Date(context.credentialExpiresAt).getTime() <= context.now.getTime()
  ) {
    return deny("authentication_expired", "Les accès OAuth ont expiré.");
  }
  if (context.connectorVersion !== "1.0.0") {
    return deny(
      "connector_version_unsupported",
      "La version du connecteur n'est pas prise en charge.",
    );
  }
  if (context.apiVersion !== "mock-v1") {
    return deny(
      "api_version_unsupported",
      "La version de l'API n'est pas prise en charge.",
    );
  }
  return { allowed: true };
}

function deny(
  code: ConnectorPolicyDenialCode,
  message: string,
): ConnectorPolicyDecision {
  return { allowed: false, code, message };
}
