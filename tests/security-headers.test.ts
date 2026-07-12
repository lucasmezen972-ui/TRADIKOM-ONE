import { describe, expect, it } from "vitest";
import nextConfig, { getGlobalSecurityHeaders } from "../next.config";

describe("secure response headers", () => {
  it("sets browser protections and a production-safe CSP", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const global = rules.find((rule) => rule.source === "/:path*");
    const headers = Object.fromEntries(
      (global?.headers ?? []).map((header) => [header.key, header.value]),
    );

    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["Referrer-Policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Permissions-Policy"]).toContain("camera=()");
    expect(headers["Content-Security-Policy"]).toContain("object-src 'none'");
    expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(headers["Content-Security-Policy"]).not.toContain("'unsafe-eval'");
  });

  it("adds HSTS only for production responses", () => {
    const production = Object.fromEntries(
      getGlobalSecurityHeaders("production").map((header) => [
        header.key,
        header.value,
      ]),
    );
    const development = Object.fromEntries(
      getGlobalSecurityHeaders("development").map((header) => [
        header.key,
        header.value,
      ]),
    );

    expect(production["Strict-Transport-Security"]).toBe(
      "max-age=31536000; includeSubDomains",
    );
    expect(development["Strict-Transport-Security"]).toBeUndefined();
  });

  it("prevents auth, token, and webhook responses from being cached", async () => {
    const rules = (await nextConfig.headers?.()) ?? [];
    const protectedRoutes = [
      "/mot-de-passe-oublie/:path*",
      "/reinitialiser-mot-de-passe/:path*",
      "/invitation/:path*",
      "/api/webhooks/:path*",
    ];

    for (const source of protectedRoutes) {
      const rule = rules.find((candidate) => candidate.source === source);
      expect(rule?.headers).toContainEqual({
        key: "Cache-Control",
        value: "no-store, max-age=0, must-revalidate",
      });
    }
  });
});
