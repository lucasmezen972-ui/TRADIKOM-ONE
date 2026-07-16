import { mkdir, writeFile } from "node:fs/promises";
import { chromium, type FullConfig, type Page } from "@playwright/test";

const warmupPaths = [
  "/",
  "/aujourdhui",
  "/mon-site",
  "/sites/garage-caraibes-auto",
  "/contacts",
  "/connexions",
  "/connexions/domaines",
  "/connexions/logiciels",
  "/connexions/donnees",
  "/oauth/mock/autoriser",
  "/api/oauth/mock/callback",
] as const;

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  if (typeof baseURL !== "string") {
    throw new Error("Playwright baseURL is required for E2E route warmup");
  }

  try {
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

    const browser = await chromium.launch();
    const page = await browser.newPage({ baseURL });
    try {
      await openDemoWithRetry(page);
      await openRouteWithRetry(page, "/mon-site", /Site Garage/i);
    } finally {
      await browser.close();
    }
  } catch (error) {
    await persistDiagnostic("global-setup-error.txt", error);
    throw error;
  }
}

async function openDemoWithRetry(page: Page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    await waitForHydration(page);
    await page.getByRole("button", { name: /Ouvrir la d.mo/i }).click();
    try {
      await page.waitForURL(/\/aujourdhui/, { timeout: 60_000 });
      await waitForHydration(page);
      return;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
}

async function openRouteWithRetry(page: Page, path: string, heading: RegExp) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto(path, { waitUntil: "domcontentloaded" });
    await waitForHydration(page);
    try {
      await page.getByRole("heading", { name: heading }).waitFor({ timeout: 60_000 });
      return;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
}

async function waitForHydration(page: Page) {
  await page
    .locator('[data-app-hydrated="true"]')
    .waitFor({ state: "attached", timeout: 60_000 });
}

async function persistDiagnostic(fileName: string, error: unknown) {
  await mkdir("test-results", { recursive: true });
  const message = error instanceof Error ? `${error.stack ?? error.message}\n` : `${String(error)}\n`;
  await writeFile(`test-results/${fileName}`, message, "utf8");
}
