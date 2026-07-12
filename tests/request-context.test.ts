import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthError } from "../src/modules/auth";
import { ConnectorError } from "../src/modules/connectors";
import { RateLimitError } from "../src/modules/rate-limit";
import {
  logServerError,
  resolveCorrelationId,
  toPublicActionError,
  toPublicError,
} from "../src/modules/request-context";

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
