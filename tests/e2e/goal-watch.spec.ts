import { expect, test } from "@playwright/test";

test("crée une tâche réelle depuis le fil puis la retrouve sur la fiche du contact", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await expect(page.locator('[data-app-hydrated="true"]')).toHaveCount(1);
  await page.getByRole("button", { name: /Ouvrir la démo/ }).click();
  await expect(page).toHaveURL(/aujourdhui/, { timeout: 30_000 });
  await page.goto("/conversation");
  await expect(page.locator('[data-app-hydrated="true"]')).toHaveCount(1);
  await page.getByLabel("Écrire depuis le web").fill("Prévoir une relance du devis client.");
  await page.locator("form").filter({ has: page.getByLabel("Écrire depuis le web") }).getByRole("button", { name: "Envoyer", exact: true }).click();
  const panel = page.getByRole("region", { name: "Action réelle dans le CRM" });
  const contactId = await panel.getByLabel("Contact à suivre").inputValue();
  const title = `Relance réelle navigateur ${Date.now()}`;
  await panel.getByLabel("Titre de la tâche").fill(title);
  await panel.getByRole("button", { name: "Préparer la proposition" }).click();
  const proposal = page.getByRole("article", { name:title, exact:true });
  await expect(proposal.getByRole("status")).toHaveText("À confirmer · aucune tâche créée");
  await page.reload();
  await expect(proposal.getByRole("status")).toHaveText("À confirmer · aucune tâche créée");
  await page.goto(`/contacts/${encodeURIComponent(contactId)}`);
  await expect(page.getByText(title, { exact:true })).toHaveCount(0);
  await page.goto("/conversation");
  await proposal.getByRole("checkbox", { name:/Je confirme la création de cette tâche/ }).check();
  await proposal.getByRole("button", { name:"Confirmer et créer la tâche" }).click();
  await expect(proposal.getByRole("status")).toHaveText("Tâche créée dans le CRM");
  await page.reload();
  await expect(proposal.getByRole("status")).toHaveText("Tâche créée dans le CRM");
  await expect(proposal.getByRole("button", { name:"Confirmer et créer la tâche" })).toHaveCount(0);
  await page.goto(`/contacts/${encodeURIComponent(contactId)}`);
  await expect(page.getByText(title, { exact: true })).toHaveCount(1);
  await page.reload();
  await expect(page.getByText(title, { exact: true })).toHaveCount(1);
});

test("refuse une proposition CRM sans créer la tâche et conserve ce refus", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await page.getByRole("button", {name:/Ouvrir la démo/}).click();
  await expect(page).toHaveURL(/aujourdhui/);
  await page.goto("/conversation");
  await page.getByLabel("Écrire depuis le web").fill("Préparer un suivi à relire avant décision.");
  await page.locator("form").filter({has:page.getByLabel("Écrire depuis le web")}).getByRole("button", {name:"Envoyer",exact:true}).click();
  const panel=page.getByRole("region", {name:"Action réelle dans le CRM"});
  const contactId=await panel.getByLabel("Contact à suivre").inputValue();
  const title=`Proposition refusée ${Date.now()}`;
  await panel.getByLabel("Titre de la tâche").fill(title);
  await panel.getByRole("button", {name:"Préparer la proposition"}).click();
  const proposal=page.getByRole("article", {name:title,exact:true});
  await proposal.getByRole("button", {name:"Refuser la proposition"}).click();
  await page.reload();
  await expect(proposal.getByRole("status")).toHaveText("Proposition refusée · aucune tâche créée");
  await expect(proposal.getByRole("button")).toHaveCount(0);
  await page.goto(`/contacts/${encodeURIComponent(contactId)}`);
  await expect(page.getByText(title,{exact:true})).toHaveCount(0);
});

test("autorise, suspend, reprend et arrête un objectif depuis Conversation", async ({ page }) => {
  test.setTimeout(120_000);
  await page.goto("/");
  await expect(page.locator('[data-app-hydrated="true"]')).toHaveCount(1);
  await page.getByRole("button", { name: /Ouvrir la démo/ }).click();
  await expect(page).toHaveURL(/aujourdhui/, { timeout: 30_000 });
  await page.goto("/conversation");
  await expect(page.locator('[data-app-hydrated="true"]')).toHaveCount(1);
  await page.getByLabel("Écrire depuis le web").fill("Je souhaite suivre mes contacts actifs.");
  await page.locator("form").filter({ has: page.getByLabel("Écrire depuis le web") }).getByRole("button", { name: "Envoyer", exact: true }).click();
  const panel = page.getByRole("region", { name: "Objectifs de cette conversation" });
  await expect(panel).toBeVisible();
  await panel.getByText("Suivre un nouvel objectif", { exact: true }).click();
  const title = `Objectif navigateur ${Date.now()}`;
  await panel.getByLabel("Nom de l’objectif").fill(title);
  await panel.getByLabel("Valeur cible").fill("2");
  await panel.getByRole("checkbox", { name: /J’autorise le suivi/ }).check();
  await panel.getByRole("button", { name: "Autoriser cet objectif" }).click();
  const goal = panel.getByRole("listitem").filter({ has: page.getByRole("heading", { name: title, exact: true }) });
  await expect(goal.getByRole("status")).toHaveText("Suivi autorisé");
  await goal.getByRole("button", { name: "Mettre en pause" }).click();
  await expect(goal.getByRole("status")).toHaveText("En pause");
  await goal.getByRole("checkbox", { name: /J’autorise le suivi/ }).check();
  await goal.getByRole("button", { name: "Reprendre le suivi" }).click();
  await expect(goal.getByRole("status")).toHaveText("Suivi autorisé");
  await goal.getByText("Arrêter définitivement", { exact: true }).click();
  await goal.getByRole("checkbox", { name: /Je confirme l’arrêt définitif/ }).check();
  await goal.getByRole("button", { name: "Confirmer l’arrêt" }).click();
  await expect(goal.getByRole("status")).toHaveText("Arrêté définitivement");
  await page.reload();
  await expect(goal.getByRole("status")).toHaveText("Arrêté définitivement");
  await expect(goal.getByRole("button", { name: "Reprendre le suivi" })).toHaveCount(0);
});

test("dicte un brouillon modifiable, joint un vrai document et télécharge l’original", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => {
    class FixtureSpeechRecognition {
      lang = ""; continuous = false; interimResults = false;
      onresult: ((e: unknown) => void) | null = null; onend: (() => void) | null = null; onerror = null;
      start() { queueMicrotask(() => { this.onresult?.({ results: [{ isFinal: true, 0: { transcript: "Analyser le document métier" } }] }); this.onend?.(); }); }
      stop() { this.onend?.(); } abort() {}
    }
    Object.defineProperty(window, "SpeechRecognition", { value: FixtureSpeechRecognition, configurable: true });
  });
  await page.goto("/");
  await expect(page.locator('[data-app-hydrated="true"]')).toHaveCount(1);
  await page.getByRole("button", { name: /Ouvrir la démo/ }).click();
  await expect(page).toHaveURL(/aujourdhui/, { timeout: 30_000 });
  await page.goto("/conversation");
  await expect(page.locator('[data-app-hydrated="true"]')).toHaveCount(1);
  await page.getByRole("checkbox", { name: /J’autorise la dictée du navigateur/ }).check();
  await page.getByRole("button", { name: "Dicter mon message" }).click();
  await expect(page.getByLabel("Écrire depuis le web")).toHaveValue("Analyser le document métier");
  await page.getByLabel("Écrire depuis le web").fill("Analyser le document métier après relecture");
  const fileName = `recette-${Date.now()}.txt`;
  const original = "Document métier navigateur\npassword=fixture-secret-value https://example.test/private";
  await page.getByLabel(/Joindre un document/).setInputFiles({ name: fileName, mimeType: "text/plain", buffer: Buffer.from(original) });
  await page.locator("form").filter({ has: page.getByLabel("Écrire depuis le web") }).getByRole("button", { name: "Envoyer", exact: true }).click();
  const attachment = page.getByRole("group", { name: fileName, exact: true });
  await expect(attachment.getByText("Extraction locale · intégrité vérifiée", { exact: true })).toBeVisible();
  await expect(attachment.getByText("Document métier navigateur", { exact: false })).toBeVisible();
  await expect(page.getByText("fixture-secret-value", { exact: false })).toHaveCount(0);
  const downloadPromise = page.waitForEvent("download", { timeout: 15000 });
  const responsePromise = page.waitForResponse(response => response.url().includes("/api/conversation/files/"));
  await page.getByRole("button", { name: `Télécharger ${fileName}` }).click();
  expect((await responsePromise).status()).toBe(200);
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe(fileName);
  const { readFile } = await import("node:fs/promises");
  expect(await readFile((await download.path())!, "utf8")).toBe(original);
  await page.reload();
  await expect(page.getByRole("button", { name: `Télécharger ${fileName}` })).toBeVisible();
});

test("installe et révoque le connecteur GitHub réel depuis les connexions", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator('[data-app-hydrated="true"]')).toHaveCount(1);
  await page.getByRole("button", { name: /Ouvrir la démo/ }).click();
  await expect(page).toHaveURL(/aujourdhui/, { timeout: 30_000 });
  await page.goto("/connexions/logiciels");
  await expect(page.locator('[data-app-hydrated="true"]')).toHaveCount(1);
  const panel = page.getByRole("region", { name: "Connecteur GitHub public" });
  await panel.getByLabel("Propriétaire", { exact: true }).fill("octocat");
  const repository = `recette-${Date.now()}`;
  await panel.getByLabel("Dépôt public", { exact: true }).fill(repository);
  await panel.getByRole("checkbox", { name: /J’autorise la lecture de ces tickets publics/ }).check();
  await panel.getByRole("button", { name: "Installer la lecture GitHub" }).click();
  const installation = panel.getByRole("listitem").filter({ has: page.getByRole("heading", { name: `octocat/${repository}` }) });
  await expect(installation.getByRole("status")).toContainText("Lecture seule active");
  await installation.getByRole("button", { name: "Révoquer l’accès GitHub" }).click();
  await expect(installation.getByRole("status")).toContainText("Accès révoqué");
  await expect(installation.getByRole("button", { name: "Lire les tickets publics" })).toHaveCount(0);
  await page.reload();
  await expect(installation.getByRole("status")).toContainText("Accès révoqué");
});
