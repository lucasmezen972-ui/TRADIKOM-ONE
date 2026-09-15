import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthError } from "../src/modules/auth";
import { ConnectorError } from "../src/modules/connectors";
import { OrchestratorError } from "../src/modules/orchestrator/errors";
import { RateLimitError } from "../src/modules/rate-limit";
import {
  logServerError,
  resolveCorrelationId,
  toPublicActionError,
  toPublicError,
} from "../src/modules/request-context";
import { WhatsAppMetaActivationAuthorizationError } from "../src/modules/channels/whatsapp-meta-activation-authorization-errors";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("request context and public errors", () => {
  it("preserves valid correlation IDs and replaces unsafe values", () => {
    expect(resolveCorrelationId("request-1234")).toBe("request-1234");

    const generated = resolveCorrelationId("token=secret value");
    expect(generated).not.toContain("secret");
    expect(generated).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("maps typed errors to safe French responses", () => {
    expect(
      toPublicError(new AuthError("invalid_credentials", "internal auth detail")),
    ).toMatchObject({
      code: "invalid_credentials",
      message: "Email ou mot de passe incorrect.",
      status: 401,
    });
    expect(toPublicError(new RateLimitError(42))).toMatchObject({
      status: 429,
      retryAfterSeconds: 42,
    });
    expect(
      toPublicError(
        new ConnectorError("webhook_oversized", "internal payload detail"),
      ),
    ).toMatchObject({ status: 413, message: "Requête trop volumineuse." });
    expect(
      toPublicError(
        new WhatsAppMetaActivationAuthorizationError(
          "channel_provider_activation_authorization_access_denied",
          "internal authorization detail",
        ),
      ),
    ).toMatchObject({
      classification: "authorization",
      status: 403,
      message: "Vous n’avez pas le droit de gérer l’autorisation d’essai Meta.",
    });
    expect(
      toPublicError(
        new WhatsAppMetaActivationAuthorizationError(
          "channel_provider_activation_authorization_invalid",
          "internal endpoint detail",
        ),
      ),
    ).toMatchObject({
      classification: "channel_activation",
      status: 409,
      message:
        "L’autorisation d’essai Meta ne peut pas être modifiée dans cet état.",
    });
    expect(
      toPublicError(
        new OrchestratorError(
          "orchestrator_source_context_invalid",
          "Le hash interne contient valeur-secrete.",
        ),
      ),
    ).toEqual({
      code: "orchestrator_source_context_invalid",
      classification: "validation",
      message: "Le contexte de ce message ne peut pas être utilisé.",
      status: 400,
    });
    expect(
      toPublicError(
        new OrchestratorError(
          "orchestrator_source_context_changed",
          "La pièce interne a changé avec valeur-secrete.",
        ),
      ),
    ).toEqual({
      code: "orchestrator_source_context_changed",
      classification: "conversation_plan",
      message: "Le plan a changé ou ne peut pas être poursuivi dans cet état.",
      status: 409,
    });
    expect(
      toPublicError(
        new OrchestratorError(
          "orchestrator_generated_plan_unsafe",
          "La sortie contient le canari privé INTERNE-NE-PAS-AFFICHER.",
        ),
      ),
    ).toEqual({
      code: "orchestrator_generated_plan_unsafe",
      classification: "conversation_plan",
      message: "Le plan n’a pas pu être préparé en toute sécurité.",
      status: 409,
    });
  });

  it("never exposes unknown database messages or stack traces", () => {
    const secret = "postgres://user:password@database/private-token";
    const mapped = toPublicError(new Error(`database failed at ${secret}`));

    expect(mapped).toEqual({
      code: "internal_error",
      classification: "internal",
      message: "Une erreur est survenue. Réessayez plus tard.",
      status: 500,
    });
    expect(JSON.stringify(mapped)).not.toContain(secret);
  });

  it("writes structured safe logs and gives actions a support reference", () => {
    const logger = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const internal = new Error("query failed with raw-token-123");

    const mapped = logServerError({
      operation: "auth.login",
      correlationId: "request-safe-123",
      error: internal,
    });
    const actionError = toPublicActionError(
      "auth.login",
      "request-safe-123",
      internal,
    );
    const output = logger.mock.calls.flat().join(" ");

    expect(mapped.status).toBe(500);
    expect(output).toContain("request.failed");
    expect(output).toContain("request-safe-123");
    expect(output).not.toContain("raw-token-123");
    expect(output).not.toContain("query failed");
    expect(actionError.message).toContain("Référence : request-safe-123");
    expect(actionError.message).not.toContain("raw-token-123");
  });
});
