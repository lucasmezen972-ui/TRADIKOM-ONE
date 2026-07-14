import { describe, expect, it } from "vitest";
import {
  EnvironmentValidationError,
  validateEnvironment,
} from "../src/lib/environment";

const productionEnvironment = {
  NODE_ENV: "production",
  APP_URL: "https://app.tradikom.example",
  DATABASE_URL: "postgres://tradikom:secret@db.example/tradikom",
  CONNECTOR_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef",
} as const;

describe("environment validation", () => {
  it("allows the local PGlite fallback outside production", () => {
    expect(validateEnvironment({ NODE_ENV: "development" })).toMatchObject({
      NODE_ENV: "development",
    });
  });

  it("requires production database, public URL, and encryption key", () => {
    expect(() =>
      validateEnvironment({ NODE_ENV: "production" }),
    ).toThrowError(
      /APP_URL, CONNECTOR_ENCRYPTION_KEY, DATABASE_URL/,
    );
  });

  it("accepts a complete production configuration", () => {
    expect(validateEnvironment(productionEnvironment)).toMatchObject(
      productionEnvironment,
    );
  });

  it("allows HTTP only for a loopback production APP_URL", () => {
    expect(
      validateEnvironment({
        ...productionEnvironment,
        APP_URL: "http://127.0.0.1:3000",
      }),
    ).toBeDefined();

    expect(() =>
      validateEnvironment({
        ...productionEnvironment,
        APP_URL: "http://app.tradikom.example",
      }),
    ).toThrowError(/APP_URL/);
  });

  it("rejects placeholder secrets without exposing their values", () => {
    const secret = "change-me-change-me-change-me-change-me";

    try {
      validateEnvironment({
        ...productionEnvironment,
        CONNECTOR_ENCRYPTION_KEY: secret,
      });
      throw new Error("Expected environment validation to fail.");
    } catch (error) {
      expect(error).toBeInstanceOf(EnvironmentValidationError);
      expect((error as Error).message).toContain("CONNECTOR_ENCRYPTION_KEY");
      expect((error as Error).message).not.toContain(secret);
    }
  });

  it("requires an API key when AI generation is enabled", () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: "test",
        FEATURE_AI_GENERATION: "true",
      }),
    ).toThrowError(/OPENAI_API_KEY/);
  });

  it("rejects malformed flags, numeric settings, and database URLs", () => {
    expect(() =>
      validateEnvironment({
        NODE_ENV: "test",
        FEATURE_PUBLIC_DEMO: "yes",
        DATABASE_POOL_MAX: "0",
        DATABASE_URL: "https://db.example/tradikom",
      }),
    ).toThrowError(/DATABASE_POOL_MAX, DATABASE_URL, FEATURE_PUBLIC_DEMO/);
  });

  it("rejects unsafe production demo and cookie combinations", () => {
    expect(() =>
      validateEnvironment({
        ...productionEnvironment,
        FEATURE_PUBLIC_DEMO: "true",
        COOKIE_SECURE: "false",
      }),
    ).toThrowError(/COOKIE_SECURE, FEATURE_PUBLIC_DEMO/);
  });

  it("validates the business timezone", () => {
    expect(
      validateEnvironment({
        NODE_ENV: "test",
        BUSINESS_TIME_ZONE: "America/Martinique",
      }).BUSINESS_TIME_ZONE,
    ).toBe("America/Martinique");
    expect(() =>
      validateEnvironment({
        NODE_ENV: "test",
        BUSINESS_TIME_ZONE: "Invalid/Timezone",
      }),
    ).toThrowError(/BUSINESS_TIME_ZONE/);
  });

  it("keeps test email and live integrations disabled in production", () => {
    expect(() =>
      validateEnvironment({
        ...productionEnvironment,
        EMAIL_PROVIDER: "test",
        FEATURE_LIVE_INTEGRATIONS: "true",
      }),
    ).toThrowError(/EMAIL_PROVIDER, FEATURE_LIVE_INTEGRATIONS/);
  });
});
