import { expect, test, type Page } from "@playwright/test";
import { getDb } from "../../src/lib/db";
import { createServices } from "../../src/lib/services";
import { processPendingDomainEvents } from "../../src/modules/workflows/worker";

test("demo user can publish site lead into CRM", async ({ page }) => {
  await openDemo(page);

  await page.getByRole("link", { name: "Mon site" }).click();
  await expect(page.getByRole("heading", { name: /Site Garage/i })).toBeVisible();
  await page.getByRole("link", { name: /Voir le site/i }).click();
  await expect(page).toHaveURL(/sites\/garage-caraibes-auto/);

  await page.getByPlaceholder("Votre nom").fill("Lead Playwright");
  await page.getByPlaceholder("Email").fill("lead-playwright@example.com");
  await page.getByPlaceholder("Telephone").fill("+596 696 12 12 12");
  await page.getByPlaceholder("Votre demande").fill("Je souhaite prendre rendez-vous.");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /Envoyer/i }).click();
  await expect(page).toHaveURL(/merci/);

  await page.goto("/contacts");
  await expect(page.getByText("lead-playwright@example.com")).toBeVisible();
});

test("the Business Brain versions and archives verified tenant memory", async ({
  page,
}) => {
  await openDemo(page);
  await page.getByRole("link", { name: "Cerveau d'entreprise" }).click();
  await expect(
    page.getByRole("heading", { name: "Cerveau d'entreprise" }),
  ).toBeVisible();

  const suffix = Date.now();
  const title = `Objectif Playwright ${suffix}`;
  const createForm = page.locator("form").filter({
    has: page.getByRole("button", { name: "Enregistrer", exact: true }),
  });
  await createForm.getByLabel("Domaine").selectOption("objectives");
  await createForm.getByLabel("Titre").fill(title);
  await createForm
    .getByLabel("Résumé")
    .fill("Atteindre un objectif commercial validé par la direction.");
  await createForm.getByLabel("Confiance").fill("92");
  await createForm
    .getByLabel("Preuve ou constat")
    .fill("Décision consignée dans le compte-rendu de direction.");
  await createForm.getByRole("button", { name: "Enregistrer", exact: true }).click();

  await expect(page.getByText("Information ajoutée à la mémoire.")).toBeVisible();
  const memory = page.locator("article").filter({ hasText: title });
  await expect(memory).toBeVisible();
  await expect(memory.getByText("v1 · 92%")).toBeVisible();

  await memory.getByText("Créer une nouvelle version").click();
  const revisedTitle = `${title} révisé`;
  const revisionForm = memory.locator("form").filter({
    has: page.getByRole("button", { name: "Enregistrer la version" }),
  });
  await revisionForm.getByLabel("Titre").fill(revisedTitle);
  await revisionForm
    .getByLabel("Résumé")
    .fill("Atteindre un objectif commercial révisé et validé.");
  await revisionForm
    .getByLabel("Preuve ou constat")
    .fill("Nouvelle décision enregistrée pendant la revue mensuelle.");
  await revisionForm
    .getByRole("button", { name: "Enregistrer la version" })
    .click();

  const revisedMemory = page.locator("article").filter({ hasText: revisedTitle });
  await expect(page.getByText("Nouvelle version enregistrée.")).toBeVisible();
  await expect(revisedMemory.getByText("v2 · 92%")).toBeVisible();
  await revisedMemory.getByRole("button", { name: "Archiver" }).click();
  await expect(page.getByText("Information archivée.")).toBeVisible();
  await expect(page.getByText(revisedTitle)).toHaveCount(0);
});

test("the strategic advisor explains and approves a proposal without execution", async ({
  page,
}) => {
  await openDemo(page);
  await page.getByRole("link", { name: "Conseiller" }).click();
  await expect(
    page.getByRole("heading", { name: "Conseiller stratégique" }),
  ).toBeVisible();
  await expect(page.getByText("Mode proposition.")).toBeVisible();
  await page.getByRole("button", { name: "Actualiser l'analyse" }).click();
  await expect(page.getByText(/Analyse terminée/)).toBeVisible();

  const proposal = page.locator("article").filter({ hasText: "À décider" }).first();
  await expect(proposal).toBeVisible();
  await expect(proposal.getByText("Pourquoi", { exact: true })).toBeVisible();
  await expect(proposal.getByText("Gain attendu", { exact: true })).toBeVisible();
  await expect(proposal.getByText("ROI", { exact: true })).toBeVisible();
  await expect(proposal.getByText("Risques", { exact: true })).toBeVisible();
  await expect(proposal.getByText("Preuves", { exact: true })).toBeVisible();
  await proposal
    .getByLabel("Motif de décision")
    .fill("Orientation validée pour planification humaine uniquement.");
  await proposal
    .getByRole("button", { name: "Approuver pour planification" })
    .click();

  await expect(page.getByText("Recommandation approuvée.")).toBeVisible();
  await expect(page.getByText("Approuvée pour planification").first()).toBeVisible();
  await page.goto("/aujourdhui");
  await expect(
    page.getByText("Décision stratégique"),
  ).toHaveCount(0);
});

test("autonomous marketing versions and approves an evidence-backed draft without publishing", async ({
  page,
}) => {
  await openDemo(page);
  await page.getByRole("link", { name: "Marketing" }).click();
  await expect(
    page.getByRole("heading", { name: "Marketing autonome" }),
  ).toBeVisible();
  await expect(page.getByText("Mode brouillon.")).toBeVisible();
  await page.getByRole("button", { name: "Préparer les brouillons" }).click();
  await expect(page.getByText(/Génération terminée/)).toBeVisible();

  const draft = page.locator("article").filter({ hasText: "Brouillon" }).first();
  await expect(draft).toBeVisible();
  await expect(draft.getByText("Preuves vérifiées", { exact: true })).toBeVisible();
  await expect(draft.getByText("Version 1", { exact: true })).toBeVisible();
  await expect(
    draft.getByRole("button", { name: /Lancer|Publier|Envoyer/i }),
  ).toHaveCount(0);

  await draft.getByText("Créer une nouvelle version").click();
  const title = `Campagne relue ${Date.now()}`;
  await draft.getByLabel("Titre").fill(title);
  await draft
    .getByLabel("Contenu")
    .fill("Garage Caraibes Auto présente son service d'entretien automobile. Demander un devis pour obtenir des informations adaptées.");
  await draft
    .getByRole("button", { name: "Enregistrer la nouvelle version" })
    .click();

  await expect(page.getByText("Nouvelle version enregistrée en brouillon.")).toBeVisible();
  const revised = page.locator("article").filter({ hasText: title });
  await expect(revised.getByText("Version 2", { exact: true })).toBeVisible();
  await revised
    .getByRole("button", { name: "Soumettre à approbation" })
    .click();

  await expect(page.getByText("Brouillon soumis à approbation.")).toBeVisible();
  const pending = page.locator("article").filter({ hasText: title });
  await pending
    .getByLabel("Motif de décision")
    .fill("Contenu factuel validé pour une planification humaine.");
  await pending
    .getByRole("button", { name: "Approuver pour planification" })
    .click();

  await expect(page.getByText("Proposition approuvée.")).toBeVisible();
  const approved = page.locator("article").filter({ hasText: title });
  await expect(
    approved.getByText("Contenu approuvé pour planification. Aucune diffusion automatique."),
  ).toBeVisible();
  await expect(
    approved.getByRole("button", { name: /Lancer|Publier|Envoyer/i }),
  ).toHaveCount(0);
});

test("Website AI applies an approved change to the draft while the public site stays immutable", async ({
  context,
  page,
}) => {
  await openDemo(page);
  await page.goto("/mon-site");
  const publicPage = await context.newPage();
  await publicPage.goto("/sites/garage-caraibes-auto");
  const liveTitle = await publicPage.getByRole("heading", { level: 1 }).innerText();

  await page.getByRole("button", { name: "Analyser le brouillon" }).click();
  await expect(page.getByText(/Analyse terminée/)).toBeVisible();
  const proposal = page.locator("article").filter({
    hasText: "Clarifier la promesse de la page d'accueil",
  });
  await expect(proposal.getByText("Preuves", { exact: true })).toBeVisible();
  await proposal
    .getByRole("button", { name: "Soumettre à approbation" })
    .click();

  const pending = page.locator("article").filter({
    hasText: "Clarifier la promesse de la page d'accueil",
  });
  await pending
    .getByLabel("Motif de décision Website AI")
    .fill("Contenu vérifié pour le brouillon, sans publication automatique.");
  await pending.getByRole("button", { name: "Approuver le brouillon" }).click();

  const approved = page.locator("article").filter({
    hasText: "Clarifier la promesse de la page d'accueil",
  });
  await approved.getByRole("button", { name: "Appliquer au brouillon" }).click();
  await expect(
    page.getByText("Amélioration appliquée au brouillon uniquement."),
  ).toBeVisible();
  await expect(page.getByText("Statut : brouillon")).toBeVisible();
  await expect(
    page.getByText("Appliquée au brouillon. Publication manuelle toujours requise."),
  ).toBeVisible();
  await expect(page.getByText(/manual_edit/).first()).toBeVisible();

  await publicPage.reload();
  await expect(publicPage.getByRole("heading", { level: 1 })).toHaveText(liveTitle);
  await publicPage.close();
});

test("draft edits keep the published site and form online until publication", async ({
  context,
  page,
}) => {
  await openDemo(page);
  await page.goto("/mon-site");

  const publicUrl = "/sites/garage-caraibes-auto";
  const publicPage = await context.newPage();
  await publicPage.goto(publicUrl);
  const originalTitle = await publicPage
    .getByRole("heading", { level: 1 })
    .innerText();
  const draftTitle = `Brouillon Playwright ${Date.now()}`;

  const heroForm = page
    .locator("form")
    .filter({ has: page.locator('input[name="title"]') })
    .first();
  await heroForm.locator('input[name="title"]').fill(draftTitle);
  await heroForm.getByRole("button", { name: "Enregistrer" }).click();

  await expect(page.getByText("Statut : brouillon")).toBeVisible();
  await expect(page.getByText(draftTitle).first()).toBeVisible();
  await publicPage.reload();
  await expect(publicPage.getByRole("heading", { level: 1 })).toHaveText(
    originalTitle,
  );
  await expect(publicPage.getByText(draftTitle)).toHaveCount(0);

  const leadEmail = `draft-playwright-${Date.now()}@example.com`;
  await publicPage
    .getByPlaceholder("Votre nom")
    .fill("Lead brouillon Playwright");
  await publicPage.getByPlaceholder("Email").fill(leadEmail);
  await publicPage.getByPlaceholder("Telephone").fill("+596 696 33 44 55");
  await publicPage
    .getByPlaceholder("Votre demande")
    .fill("Le formulaire public reste disponible pendant les modifications.");
  await publicPage.getByRole("checkbox").check();
  await publicPage.getByRole("button", { name: /Envoyer/i }).click();
  await expect(publicPage).toHaveURL(/merci/);

  await page.getByRole("button", { name: "Publier" }).click();
  await expect(page.getByText("Statut : publie")).toBeVisible();
  await publicPage.goto(publicUrl);
  await expect(publicPage.getByRole("heading", { level: 1 })).toHaveText(
    draftTitle,
  );

  const publicationVersions = page
    .getByRole("heading", { name: "Versions" })
    .locator("..")
    .locator("form")
    .filter({ hasText: /^publication -/ });
  await expect(publicationVersions).toHaveCount(2);
  await publicationVersions
    .last()
    .getByRole("button", { name: "Restaurer" })
    .click();
  await expect(page.getByText("Statut : brouillon")).toBeVisible();
  await expect(page.getByText(originalTitle).first()).toBeVisible();

  await publicPage.reload();
  await expect(publicPage.getByRole("heading", { level: 1 })).toHaveText(
    draftTitle,
  );
  await page.getByRole("button", { name: "Publier" }).click();
  await expect(page.getByText("Statut : publie")).toBeVisible();
  await publicPage.reload();
  await expect(publicPage.getByRole("heading", { level: 1 })).toHaveText(
    originalTitle,
  );

  await page.goto("/contacts");
  await expect(page.getByText(leadEmail)).toBeVisible();
});

test("the command center turns a public lead into isolated operational work", async ({
  browser,
  page,
}) => {
  await openDemo(page);
  const leadEmail = `command-center-${Date.now()}@example.com`;
  await page.goto("/sites/garage-caraibes-auto");
  await page.getByPlaceholder("Votre nom").fill("Lead centre de pilotage");
  await page.getByPlaceholder("Email").fill(leadEmail);
  await page.getByPlaceholder("Telephone").fill("+596 696 55 66 77");
  await page
    .getByPlaceholder("Votre demande")
    .fill("Je souhaite être rappelé pour une intervention.");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /Envoyer/i }).click();
  await expect(page).toHaveURL(/merci/);

  const db = await getDb();
  const demo = await db.query<{ tenant_id: string; user_id: string }>(
    `select tenants.id as tenant_id, memberships.user_id
     from tenants
     join memberships on memberships.tenant_id = tenants.id
     where tenants.slug = $1 and memberships.role = 'owner'
     limit 1`,
    ["garage-caraibes-auto"],
  );
  const demoTenantId = demo.rows[0]?.tenant_id;
  const demoUserId = demo.rows[0]?.user_id;
  if (!demoTenantId || !demoUserId) {
    throw new Error("Le tenant de démonstration est introuvable.");
  }

  const workerNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000);
  for (let pass = 0; pass < 12; pass += 1) {
    const summary = await processPendingDomainEvents(db, {
      now: workerNow,
      limit: 100,
    });
    if (summary.selected === 0) break;
  }
  const workflowWork = await db.query<{ task_count: number; run_count: number }>(
    `select
       (select count(*)::int from tasks
        join leads on leads.id = tasks.related_id
          and leads.tenant_id = tasks.tenant_id
          and tasks.related_type = 'lead'
        join contacts on contacts.id = leads.contact_id
          and contacts.tenant_id = leads.tenant_id
        where tasks.tenant_id = $1 and contacts.email = $2) as task_count,
       (select count(*)::int from workflow_runs
        where tenant_id = $1 and trigger_name = 'lead.created') as run_count`,
    [demoTenantId, leadEmail],
  );
  expect(Number(workflowWork.rows[0]?.task_count)).toBeGreaterThan(0);
  expect(Number(workflowWork.rows[0]?.run_count)).toBeGreaterThan(0);

  await db.query(
    `insert into approvals
      (id, tenant_id, requested_by, policy, status, target_type, target_id, created_at)
     values ($1, $2, $3, 'administrator_approval_required', 'pending',
       'workflow_run', $4, $5)`,
    [
      `e2e-command-center-approval-${Date.now()}`,
      demoTenantId,
      demoUserId,
      `e2e-command-center-run-${Date.now()}`,
      new Date().toISOString(),
    ],
  );

  await page.goto("/contacts");
  await expect(page.getByText(leadEmail)).toBeVisible();
  await page.goto("/aujourdhui");
  await expect(
    page.getByRole("heading", { name: /Priorités de Garage Caraibes Auto/i }),
  ).toBeVisible();
  await expect(page.getByText("Lead centre de pilotage").first()).toBeVisible();
  await expect(
    page.getByRole("link", { name: /Approbation d'automatisation/ }).first(),
  ).toBeVisible();
  await expect(page.getByText("Configuration requise").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Opportunity Radar" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Site web" })).toBeVisible();

  const services = createServices(db);
  const isolatedEmail = `isolated-command-center-${Date.now()}@example.com`;
  const isolatedPassword = "Isolated!2026";
  const isolatedUser = await services.registerUser({
    name: "Organisation isolée",
    email: isolatedEmail,
    password: isolatedPassword,
  });
  await services.createTenant(isolatedUser.id, {
    name: "Organisation sans activité",
    category: "Services",
  });

  const isolatedContext = await browser.newContext();
  const isolatedPage = await isolatedContext.newPage();
  await isolatedPage.goto("/");
  const loginForm = isolatedPage.locator("form").filter({
    has: isolatedPage.getByRole("button", { name: "Se connecter" }),
  });
  await loginForm.getByPlaceholder("Email professionnel").fill(isolatedEmail);
  await loginForm.getByPlaceholder("Mot de passe").fill(isolatedPassword);
  await loginForm.getByRole("button", { name: "Se connecter" }).click();
  await expect(isolatedPage).toHaveURL(/aujourdhui/);
  await expect(isolatedPage.getByText(leadEmail)).toHaveCount(0);
  await expect(
    isolatedPage.getByText("Aucun nouveau lead aujourd'hui."),
  ).toBeVisible();
  await isolatedPage.goto("/contacts");
  await expect(isolatedPage.getByText(leadEmail)).toHaveCount(0);
  await isolatedContext.close();
});

async function openDemo(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Ouvrir la d.mo/i }).click();
  await expect(page).toHaveURL(/aujourdhui/);
}
