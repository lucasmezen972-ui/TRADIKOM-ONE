import { afterEach, describe, expect, it } from "vitest";
import { isTrustedFormOrigin, redirectFormPost } from "../src/lib/form-post";

const originalAppUrl = process.env.APP_URL;

afterEach(() => {
  if (originalAppUrl === undefined) {
    delete process.env.APP_URL;
  } else {
    process.env.APP_URL = originalAppUrl;
  }
});

describe("native form POST security", () => {
  it("accepts only the configured application origin", () => {
    process.env.APP_URL = "http://127.0.0.1:3000";

    expect(
      isTrustedFormOrigin(
        new Request("http://internal-host/api/auth/login", {
          headers: { origin: "http://127.0.0.1:3000" },
        }),
      ),
    ).toBe(true);
    expect(
      isTrustedFormOrigin(
        new Request("http://internal-host/api/auth/login", {
          headers: { origin: "http://localhost:3000" },
        }),
      ),
    ).toBe(false);
    expect(
      isTrustedFormOrigin(new Request("http://internal-host/api/auth/login")),
    ).toBe(false);
  });

  it("returns a relative no-store 303 redirect", () => {
    const response = redirectFormPost("/aujourdhui?source=formulaire");

    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "/aujourdhui?source=formulaire",
    );
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("rejects absolute and protocol-relative redirect targets", () => {
    expect(() => redirectFormPost("https://example.com")).toThrow(
      "Form redirect path must stay on the application origin.",
    );
    expect(() => redirectFormPost("//example.com")).toThrow(
      "Form redirect path must stay on the application origin.",
    );
    expect(() => redirectFormPost("aujourdhui")).toThrow(
      "Form redirect path must stay on the application origin.",
    );
  });
});
