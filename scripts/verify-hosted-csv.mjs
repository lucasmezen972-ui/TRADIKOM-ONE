// Authorized demo company only; credentials/access links are private files.
import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";

const config = JSON.parse(await fs.readFile(process.argv[2], "utf8"));
if (config.authorizedMutation !== "csv-demo" || !config.companyName || !config.runId) throw new Error("explicit_demo_scope_required");
const credentials = await fs.readFile(config.credentialsFile, "utf8");
const email = credentials.match(/^E-mail : (.+)$/m)?.[1];
const password = credentials.match(/^Mot de passe initial : (.+)$/m)?.[1];
if (!email || !password) throw new Error("private_credentials_unavailable");
const { url } = JSON.parse(await fs.readFile(config.accessFile, "utf8"));
const origin = new URL(url).origin;
if (origin !== config.expectedOrigin) throw new Error("canonical_origin_mismatch");
const proxyUrl = process.env.HTTPS_PROXY ? new URL(process.env.HTTPS_PROXY) : null;
const proxy = proxyUrl ? { server: proxyUrl.origin, username: decodeURIComponent(proxyUrl.username), password: decodeURIComponent(proxyUrl.password) } : undefined;
const browser = await chromium.launch({ executablePath: config.chromiumPath, proxy, args: config.chromiumArgs ?? ["--no-sandbox", "--disable-dev-shm-usage"] });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true });
page.setDefaultTimeout(45000);
const check = expect.configure({ timeout: 45000 });
const proof = { sourceCommit: config.sourceCommit, runId: config.runId, hosted: true, newAccounts: 0, steps: [] };
let signedIn = false;
let stage = "login";
const name = `Contact Démo CSV ${config.runId}`;
const filename = `recette-csv-${config.runId}.csv`;
const csv = `nom,email,telephone\nContact Démo Guidée 20261103-1404-guided,demo-guided-20261103-1404-guided@example.test,\n${name},csv-check-${config.runId}@example.test,\n`;
async function hydrated() { await check(page.locator('[data-app-hydrated="true"]')).toHaveCount(1); }
async function done(details = {}) {
  proof.steps.push({ stage, passed: true, ...details });
  await fs.writeFile(config.proofFile, JSON.stringify(proof, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify({ stage, passed: true, ...details }));
}
const summary = page.locator("section").filter({ has: page.getByRole("heading", { level: 2, name: filename, exact: true }) });
async function metric(label, value) {
  await check(summary.getByText(label, { exact: true }).locator("..").locator("dd")).toHaveText(String(value));
}
async function preview() {
  await page.getByLabel("Fichier", { exact: true }).setInputFiles({ name: filename, mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: "Valider l’aperçu", exact: true }).click();
  await check(summary).toBeVisible();
  await metric("Lignes", 2);
  await metric("Invalides", 0);
}
try {
  await page.goto(url);
  await hydrated();
  const form = page.locator('form[action="/api/auth/login"]');
  await form.getByPlaceholder("Email professionnel").fill(email);
  await form.getByPlaceholder("Mot de passe", { exact: true }).fill(password);
  await form.getByRole("button", { name: /connecter/i }).click();
  await check(page).toHaveURL(/aujourdhui/);
  signedIn = true;
  await check(page.getByRole("heading", { name: `Priorités de ${config.companyName}`, exact: true })).toBeVisible();
  await done({ independentLogin: true });

  stage = "preview_and_import";
  await page.goto(origin + "/connexions/donnees");
  await hydrated();
  await preview();
  await metric("Valides", 1);
  await metric("Doublons", 1);
  await metric("Importées", 0);
  await summary.getByRole("button", { name: "Finaliser l’import", exact: true }).click();
  await metric("Importées", 1);
  await page.reload();
  await metric("Importées", 1);
  await metric("Doublons", 1);
  proof.firstImportId = new URL(page.url()).searchParams.get("import");
  await done({ previewValid: 1, previewDuplicates: 1, imported: 1, reloaded: true });

  stage = "duplicate_only_import";
  await preview();
  await metric("Valides", 0);
  await metric("Doublons", 2);
  await summary.getByRole("button", { name: "Finaliser l’import", exact: true }).click();
  await check(summary.getByRole("button", { name: "Finaliser l’import", exact: true })).toHaveCount(0);
  await page.reload();
  await metric("Importées", 0);
  await metric("Doublons", 2);
  proof.secondImportId = new URL(page.url()).searchParams.get("import");
  await done({ previewDuplicates: 2, imported: 0, reloaded: true });

  stage = "crm_and_responsive";
  proof.contactName = name;
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    await page.goto(origin + "/contacts");
    const link = page.getByRole("link", { name, exact: true });
    await check(link).toHaveCount(1);
    proof.contactId = (await link.getAttribute("href")).split("/").at(-1);
    await page.reload();
    await check(link).toHaveCount(1);
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw new Error("horizontal_overflow");
    await page.goto(origin + "/connexions/donnees");
    await hydrated();
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw new Error("horizontal_overflow");
  }
  await done({ mobile: "390x844", desktop: "1440x900", oneContact: true, horizontalOverflow: false });
  proof.passed = true;
} catch (error) {
  proof.passed = false;
  proof.failedStage = stage;
  proof.errorName = error.name;
  proof.failurePath = new URL(page.url()).pathname;
  console.log(JSON.stringify({ stage, passed: false, error: error.name }));
  process.exitCode = 1;
} finally {
  if (signedIn) {
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(origin + "/conversation");
      await page.getByRole("button", { name: "Déconnexion", exact: true }).click();
      await check(page).toHaveURL(origin + "/");
      proof.testSessionLoggedOut = true;
    } catch { proof.testSessionLoggedOut = false; process.exitCode = 1; }
  }
  proof.finishedAt = new Date().toISOString();
  await fs.writeFile(config.proofFile, JSON.stringify(proof, null, 2) + "\n", { mode: 0o600 });
  await browser.close();
}
