// Run only against an explicitly authorized fictitious company. Configuration,
// credentials and temporary Vercel access links stay outside the repository.
import { chromium, expect } from "@playwright/test";
import fs from "node:fs/promises";

const configPath = process.argv[2];
if (!configPath) throw new Error("private_recipe_config_required");
const config = JSON.parse(await fs.readFile(configPath, "utf8"));
if (config.authorizedMutation !== "guided-crm-demo" || !config.companyName || !/^[a-z0-9-]{8,64}$/.test(config.runId)) {
  throw new Error("explicit_demo_recipe_scope_required");
}
const credentials = await fs.readFile(config.credentialsFile, "utf8");
const email = credentials.match(/^E-mail : (.+)$/m)?.[1];
const password = credentials.match(/^Mot de passe initial : (.+)$/m)?.[1];
if (!email || !password) throw new Error("private_credentials_unavailable");
const access = JSON.parse(await fs.readFile(config.accessFile, "utf8"));
const origin = new URL(access.url).origin;
if (origin !== config.expectedOrigin || !origin.endsWith(".vercel.app")) throw new Error("deployment_origin_mismatch");
const proxyUrl = process.env.HTTPS_PROXY ? new URL(process.env.HTTPS_PROXY) : null;
const proxy = proxyUrl ? { server: proxyUrl.origin, username: decodeURIComponent(proxyUrl.username), password: decodeURIComponent(proxyUrl.password) } : undefined;
const browser = await chromium.launch({ executablePath: config.chromiumPath, proxy, args: ["--no-sandbox", "--disable-dev-shm-usage"] });
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
const page = await context.newPage();
page.setDefaultTimeout(45000);
const check = expect.configure({ timeout: 45000 });
const proof = { runId: config.runId, sourceCommit: config.sourceCommit, viewport: "390x844", hosted: true, steps: [], newAccounts: 0, accountAndCompanyPreserved: true };
let stage = "open_protected_preview";
let signedIn = false;
async function persist() { await fs.writeFile(config.proofFile, JSON.stringify(proof, null, 2) + "\n", { mode: 0o600 }); }
async function done(details = {}) {
  proof.steps.push({ stage, passed: true, ...details });
  await persist();
  console.log(JSON.stringify({ stage, passed: true, ...details }));
}
async function hydrated() { await check(page.locator('[data-app-hydrated="true"]')).toHaveCount(1); }
async function overflow() {
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1)) throw new Error("horizontal_overflow");
}
const title = `Recette guidée — tâche confirmée ${config.runId}`;
const rejectedTitle = `Recette guidée — proposition refusée ${config.runId}`;
const contactName = `Contact Démo Guidée ${config.runId}`;
try {
  const initialResponse = await page.goto(access.url);
  proof.initialHttp = initialResponse?.status();
  stage = "initial_hydration";
  await hydrated();
  stage = "login";
  const login = page.locator('form[action="/api/auth/login"]');
  await login.getByPlaceholder("Email professionnel").fill(email);
  await login.getByPlaceholder("Mot de passe", { exact: true }).fill(password);
  await login.getByRole("button", { name: /connecter/i }).click();
  stage = "dashboard_after_login";
  await check(page).toHaveURL(/aujourdhui/);
  signedIn = true;
  await check(page.getByRole("heading", { name: `Priorités de ${config.companyName}`, exact: true })).toBeVisible();
  await overflow();
  await done({ independentLogin: true });

  stage = "contact_import";
  await page.goto(origin + "/connexions/donnees");
  await hydrated();
  await page.getByLabel("Fichier", { exact: true }).setInputFiles({ name: `demo-guidee-${config.runId}.csv`, mimeType: "text/csv", buffer: Buffer.from(`nom,email,telephone\n${contactName},demo-guided-${config.runId}@example.test,\n`) });
  await page.getByRole("button", { name: "Valider l’aperçu", exact: true }).click();
  await check(page.getByRole("button", { name: "Finaliser l’import", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Finaliser l’import", exact: true }).click();
  await check(page.getByRole("button", { name: "Annuler les données importées", exact: true })).toBeVisible();
  await done({ fictitiousContactsImported: 1 });

  stage = "prepare_proposal";
  await page.goto(origin + "/conversation");
  await hydrated();
  await page.getByLabel("Écrire depuis le web").fill("Recette sur données fictives : préparer le suivi du devis, à relire avant toute création de tâche. Aucun envoi externe.");
  await page.locator("form").filter({ has: page.getByLabel("Écrire depuis le web") }).getByRole("button", { name: "Envoyer", exact: true }).click();
  const panel = page.getByRole("region", { name: "Action réelle dans le CRM" });
  await panel.getByLabel("Contact à suivre").selectOption({ label: contactName });
  const contactId = await panel.getByLabel("Contact à suivre").inputValue();
  proof.contactId = contactId;
  proof.approvedTitle = title;
  proof.rejectedTitle = rejectedTitle;
  await panel.getByLabel("Titre de la tâche").fill(title);
  await panel.getByRole("button", { name: "Préparer la proposition", exact: true }).click();
  const proposal = page.getByRole("article", { name: title, exact: true });
  await check(proposal.getByRole("status")).toHaveText("À confirmer · aucune tâche créée");
  proof.proposalId = (await proposal.getAttribute("id")).replace(/^task-proposal-/, "");
  const conversationUrl = page.url();
  await page.reload();
  await check(proposal.getByRole("status")).toHaveText("À confirmer · aucune tâche créée");
  await overflow();
  await page.goto(`${origin}/contacts/${encodeURIComponent(contactId)}`);
  await check(page.getByText(title, { exact: true })).toHaveCount(0);
  await done({ proposalReloaded: true, noTaskBeforeConfirmation: true });

  stage = "confirm_and_replay";
  await page.goto(conversationUrl);
  await proposal.getByRole("checkbox", { name: /Je confirme la création de cette tâche/ }).check();
  let captured;
  const capture = request => {
    if (request.method() !== "POST" || new URL(request.url()).pathname !== "/conversation") return;
    const original = request.headers();
    const headers = {};
    for (const key of ["content-type", "accept", "next-action", "next-router-state-tree"]) if (original[key]) headers[key] = original[key];
    headers.origin = origin;
    headers.referer = origin + "/conversation";
    captured = { headers, data: request.postDataBuffer() };
  };
  page.on("request", capture);
  await proposal.getByRole("button", { name: "Confirmer et créer la tâche", exact: true }).click();
  await check(proposal.getByRole("status")).toHaveText("Tâche créée dans le CRM");
  page.off("request", capture);
  if (!captured?.data) throw new Error("confirmation_request_not_captured");
  const replay = await context.request.post(origin + "/conversation", { ...captured, maxRedirects: 0 });
  const redirect = replay.headers()["x-action-redirect"] || replay.headers().location || "";
  if (![200, 303].includes(replay.status()) || !redirect.includes(proof.proposalId)) throw new Error("confirmation_replay_not_proven");
  captured = undefined;
  await page.reload();
  await check(proposal.getByRole("status")).toHaveText("Tâche créée dans le CRM");
  await check(proposal.getByRole("button", { name: "Confirmer et créer la tâche" })).toHaveCount(0);
  await check(page.getByText(`Tâche créée dans le CRM : ${title}`, { exact: false })).toBeVisible();
  await overflow();
  await page.goto(`${origin}/contacts/${encodeURIComponent(contactId)}`);
  await check(page.getByText(title, { exact: true })).toHaveCount(1);
  await page.reload();
  await check(page.getByText(title, { exact: true })).toHaveCount(1);
  await done({ replayHttp: replay.status(), reportReloaded: true, crmTaskReloaded: true, visibleTaskCopies: 1 });

  stage = "reject_proposal";
  await page.goto(conversationUrl);
  await panel.getByLabel("Contact à suivre").selectOption(contactId);
  await panel.getByLabel("Titre de la tâche").fill(rejectedTitle);
  await panel.getByRole("button", { name: "Préparer la proposition", exact: true }).click();
  const rejected = page.getByRole("article", { name: rejectedTitle, exact: true });
  await check(rejected.getByRole("status")).toHaveText("À confirmer · aucune tâche créée");
  proof.rejectedProposalId = (await rejected.getAttribute("id")).replace(/^task-proposal-/, "");
  await rejected.getByRole("button", { name: "Refuser la proposition", exact: true }).click();
  await page.reload();
  await check(rejected.getByRole("status")).toHaveText("Proposition refusée · aucune tâche créée");
  await check(rejected.getByRole("button")).toHaveCount(0);
  await overflow();
  await page.goto(`${origin}/contacts/${encodeURIComponent(contactId)}`);
  await check(page.getByText(rejectedTitle, { exact: true })).toHaveCount(0);
  await check(page.getByText(title, { exact: true })).toHaveCount(1);
  await done({ refusalReloaded: true, refusedTaskAbsent: true });

  stage = "responsive_reload";
  for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
    await page.setViewportSize(viewport);
    for (const path of ["/aujourdhui", "/contacts", "/conversation"]) {
      const response = await page.goto(origin + path);
      if (response.status() !== 200) throw new Error("route_unavailable");
      await hydrated();
      await page.reload();
      await hydrated();
      await overflow();
    }
  }
  await done({ mobileAndDesktop: true, routes: 3, reloads: true, horizontalOverflow: false });
  proof.passed = true;
} catch (error) {
  proof.passed = false;
  proof.failedStage = stage;
  proof.errorName = error.name;
  proof.failurePath = new URL(page.url()).pathname;
  proof.hydratedElements = await page.locator('[data-app-hydrated="true"]').count();
  proof.loginForms = await page.locator('form[action="/api/auth/login"]').count();
  proof.headingText = await page.getByRole("heading").allTextContents();
  console.log(JSON.stringify({ stage, passed: false, error: error.name, reason: ["horizontal_overflow", "route_unavailable", "confirmation_request_not_captured", "confirmation_replay_not_proven"].includes(error.message) ? error.message : "browser_check_failed" }));
  process.exitCode = 1;
} finally {
  if (signedIn) {
    try {
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.goto(origin + "/conversation");
      await page.getByRole("button", { name: "Déconnexion", exact: true }).click();
      await check(page).toHaveURL(origin + "/");
      proof.testSessionLoggedOut = true;
    } catch {
      proof.testSessionLoggedOut = false;
      process.exitCode = 1;
    }
  }
  proof.finishedAt = new Date().toISOString();
  await persist();
  await browser.close();
}
