import type { FullConfig } from "@playwright/test";

const warmupPaths = [
  "/sites/garage-caraibes-auto",
  "/oauth/mock/autoriser",
  "/api/oauth/mock/callback",
] as const;

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  if (typeof baseURL !== "string") {
    throw new Error("Playwright baseURL is required for E2E route warmup");
  }

  for (const path of warmupPaths) {
    const url = new URL(path, baseURL);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(60_000),
      });
      await response.arrayBuffer();
    }
  }
}
