import { chromium, type FullConfig, type Page } from "@playwright/test";
import { getDb } from "../../src/lib/db";

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
  const warmupAccountLabel = `E2E route warmup ${Date.now()}`;
  try {
    await openDemoWithRetry(page);

    await page.goto("/mon-site", { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: /Site Garage/i }).waitFor({ timeout: 60_000 });

    await completeOAuthWarmup(page, warmupAccountLabel);
  } finally {
    await browser.close();
    const db = await getDb();
    await db.query("delete from software_connections where account_label = $1", [
      warmupAccountLabel,
    ]);
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

async function completeOAuthWarmup(page: Page, accountLabel: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.goto("/connexions/logiciels", { waitUntil: "domcontentloaded" });
    await waitForHydration(page);
    await page
      .getByRole("heading", { name: "Connexions logicielles" })
      .waitFor({ timeout: 60_000 });

    const provider = page.locator("article").filter({ hasText: "Mock Business" }).first();
    await provider.getByLabel("Libellé du compte").fill(accountLabel);
    await provider.getByRole("button", { name: "Connecter avec OAuth" }).click();
    try {
      await page
        .getByRole("heading", { name: "Autoriser Mock Business" })
        .waitFor({ timeout: 60_000 });
      await waitForHydration(page);
      await page.getByRole("button", { name: "Autoriser la connexion" }).click();
      await page.waitForURL(/connexions\/logiciels\?oauth=connecte/, {
        timeout: 60_000,
      });
      return;
    } catch (error) {
      if (attempt === 2) throw error;
    }
  }
}

async function waitForHydration(page: Page) {
  await page.locator('[data-app-hydrated="true"]').waitFor({ timeout: 60_000 });
}
