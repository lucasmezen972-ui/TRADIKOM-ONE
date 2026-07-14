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

test("a tenant administrator approves and simulates a DNS plan without applying it", async ({
  page,
}) => {
  await openDemo(page);
  await page.goto("/connexions/domaines");
  await expect(
    page.getByRole("heading", { name: "Domaines", exact: true }),
  ).toBeVisible();
  const domain = `atelier-${Date.now()}.example.test`;
  await page.getByLabel("Nom de domaine").fill(domain);
  await page.getByLabel("Méthode").selectOption("mock_dns");
  await page.getByRole("button", { name: "Analyser le domaine" }).click();

  const connection = page.locator("article").filter({ hasText: domain }).first();
  await expect(connection.getByText("Analysé", { exact: true })).toBeVisible();
  await expect(connection.getByText("Registraire de test")).toBeVisible();
  await expect(connection.getByText("MX", { exact: true })).toBeVisible();
  await connection.getByRole("button", { name: "Préparer le plan DNS" }).click();

  let plan = page.locator("article").filter({ hasText: domain }).filter({
    hasText: "Première approbation requise",
  });
  await expect(plan.getByText("Aucun effet externe")).toBeVisible();
  await plan.getByRole("button", { name: "Approuver le plan" }).click();

  plan = page.locator("article").filter({ hasText: domain }).filter({
    hasText: "Deuxième confirmation requise",
  });
  await plan
    .getByRole("button", { name: "Confirmer une seconde fois" })
    .click();

  plan = page.locator("article").filter({ hasText: domain }).filter({
    hasText: "Prêt à simuler",
  });
  await plan.getByRole("button", { name: "Simuler le changement" }).click();

  plan = page.locator("article").filter({ hasText: domain }).filter({
    hasText: "Simulation réussie",
  });
  await expect(
    plan.getByText("Simulation terminée, aucune modification appliquée"),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Appliquer|Modifier les DNS|Publier/i }),
  ).toHaveCount(0);
});

test("a tenant administrator connects and revokes the local OAuth provider without exposing tokens", async ({
  page,
}) => {
  await openDemo(page);
  await page.goto("/connexions/logiciels");
  await expect(
    page.getByRole("heading", { name: "Connexions logicielles" }),
  ).toBeVisible();

  const accountLabel = `Compte OAuth ${Date.now()}`;
  const provider = page.locator("article").filter({ hasText: "Mock Business" }).first();
  await provider.getByLabel("Libellé du compte").fill(accountLabel);
  await provider.getByRole("button", { name: "Connecter avec OAuth" }).click();

  await expect(
    page.getByRole("heading", { name: "Autoriser Mock Business" }),
  ).toBeVisible();
  await expect(page.getByText("Lire les contacts", { exact: true })).toBeVisible();
  await expect(page.getByText("Lire le profil du compte", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Autoriser la connexion" }).click();

  await expect(page).toHaveURL(/connexions\/logiciels\?oauth=connecte/);
  await expect(page.getByText(/Aucun jeton n’a été exposé/)).toBeVisible();
  const connection = page.locator("article").filter({ hasText: accountLabel });
  await expect(connection.getByText("Connecté", { exact: true })).toBeVisible();
  await expect(connection.getByText("Lecture des contacts")).toBeVisible();
  await expect(connection.getByText("Lecture du profil")).toBeVisible();
  await expect(page.getByText(/mock_access_|mock_refresh_/)).toHaveCount(0);

  await connection.getByRole("button", { name: "Déconnecter" }).click();
  const disconnected = page.locator("article").filter({ hasText: accountLabel });
  await expect(
    disconnected.getByText("Déconnecté", { exact: true }),
  ).toBeVisible();
  await expect(
    disconnected.getByRole("button", { name: "Rafraîchir l’accès" }),
  ).toHaveCount(0);
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

test("Sales AI explains CRM priorities without creating outbound actions", async ({
  page,
}) => {
  await openDemo(page);
  await page.getByRole("link", { name: "Assistant commercial" }).click();
  await expect(
    page.getByRole("heading", { name: "Assistant commercial" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Actualiser l'analyse" }).click();
  await expect(page.getByText(/Analyse terminee|Analyse terminée/)).toBeVisible();
  const assessment = page.locator("article").first();
  await expect(assessment.getByText("Preuves CRM", { exact: true })).toBeVisible();
  await expect(assessment.getByText("Potentiel", { exact: true })).toBeVisible();
  await expect(
    assessment.getByRole("link", { name: "Ouvrir l'opportunité" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Envoyer|Devis|Remise|Contacter/i }),
  ).toHaveCount(0);
});

test("Financial AI explains declared estimates without accounting or external writes", async ({
  page,
}) => {
  await openDemo(page);
  await page.getByRole("link", { name: "Pilotage financier" }).click();
  await expect(
    page.getByRole("heading", { name: "Pilotage financier" }),
  ).toBeVisible();
  await page.getByLabel("Période").fill("2026-07");
  await page.getByLabel("Revenu mensuel (€)").fill("120000");
  await page.getByLabel("Charges d'exploitation (€)").fill("90000");
  await page.getByLabel("Solde de trésorerie (€)").fill("25000");
  await page.getByLabel("Encaissements du mois (€)").fill("100000");
  await page.getByLabel("Décaissements du mois (€)").fill("110000");
  await page.getByLabel("Créances clients (€)").fill("15000");
  await page.getByLabel("Dettes fournisseurs (€)").fill("18000");
  await page.getByLabel("Coût marketing (€)").fill("4000");
  await page.getByLabel("Revenu attribué au marketing (€)").fill("10000");
  await page.getByLabel("Coût commercial (€)").fill("3000");
  await page.getByLabel("Revenu attribué au commercial (€)").fill("9000");
  await page.getByLabel("Coût du site web (€)").fill("1000");
  await page.getByLabel("Coût des automatisations (€)").fill("500");
  await page.getByLabel("Nouveaux clients").fill("10");
  await page.getByLabel("Clients actifs").fill("80");
  await page.getByLabel("Durée client moyenne en mois").fill("24");
  await page
    .getByLabel("Source ou justificatif interne")
    .fill("Revue mensuelle validée pour le scénario Playwright.");
  await page
    .getByRole("button", { name: "Enregistrer les données déclarées" })
    .click();
  await expect(page.getByText("Photographie financière enregistrée.")).toBeVisible();
  await page.getByRole("button", { name: "Actualiser l'estimation" }).click();
  await expect(page.getByText("Estimation calculée")).toBeVisible();
  await expect(page.getByText("Résultat estimé", { exact: true })).toBeVisible();
  await expect(page.getByText("Marge estimée", { exact: true })).toBeVisible();
  await expect(page.getByText("Projection indicative à 3 mois", { exact: true })).toBeVisible();
  await expect(page.getByText("Données insuffisantes").first()).toBeVisible();
  await expect(page.getByText("Preuves et formules utilisées")).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Payer|Virer|Synchroniser la banque|Envoyer/i }),
  ).toHaveCount(0);
});

test("AI Employee profiles remain bounded, versioned and unable to execute externally", async ({
  page,
}) => {
  await openDemo(page);
  await page.getByRole("link", { name: "Équipe IA" }).click();
  await expect(page.getByRole("heading", { name: "Équipe IA" })).toBeVisible();
  await expect(page.getByText("Collègues virtuels").first()).toBeVisible();
  await expect(page.getByText("Actions externes autorisées")).toBeVisible();
  const analyst = page.locator("article").filter({
    hasText: "Analyste d'entreprise IA",
  });
  await expect(analyst).toBeVisible();
  await expect(analyst.getByText("Transactions financières : interdites")).toBeVisible();
  await analyst.getByText("Configurer ce profil").click();
  await analyst.getByLabel("Nom affiché").fill("Analyste Playwright IA");
  await analyst
    .getByLabel("Mission")
    .fill("Préparer des synthèses internes vérifiables pour la revue Playwright.");
  await analyst.getByLabel("État").selectOption("paused");
  await analyst
    .getByRole("button", { name: "Enregistrer une nouvelle version" })
    .click();
  await expect(page.getByText("Nouvelle version du profil enregistrée.")).toBeVisible();
  const revised = page.locator("article").filter({
    hasText: "Analyste Playwright IA",
  });
  await expect(revised.getByText("version 2")).toBeVisible();
  await expect(revised.getByText("En pause").first()).toBeVisible();
  await expect(page.getByText("Profil virtuel mis en pause").first()).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Envoyer|Publier|Payer|Activer un connecteur/i }),
  ).toHaveCount(0);
});

test("Reputation AI prepares an approved response without publishing it", async ({
  page,
}) => {
  await openDemo(page);
  await page.getByRole("link", { name: "Réputation" }).click();
  await expect(page.getByRole("heading", { name: "Réputation" })).toBeVisible();
  const marker = `Avis Playwright ${Date.now()}`;
  await page.getByLabel("Source déclarée").selectOption("manual_import");
  await page.getByLabel("Note, facultative").selectOption("1");
  await page
    .getByLabel("Texte de l'avis")
    .fill(`${marker} : retard, attente et problème non résolu.`);
  await page.getByRole("button", { name: "Importer l'avis" }).click();
  await expect(
    page.getByText("Avis importé sans accès à une plateforme externe."),
  ).toBeVisible();
  await expect(page.getByText(new RegExp(marker)).first()).toBeVisible();

  await page.getByRole("button", { name: "Analyser les avis" }).click();
  await expect(page.getByText(/Analyse terminée/)).toBeVisible();
  const proposal = page.locator("article").filter({ hasText: marker }).last();
  await expect(proposal.getByText("Preuves utilisées", { exact: true })).toBeVisible();
  await expect(
    proposal.getByText(/Non évaluée : aucune identité/),
  ).toBeVisible();
  await proposal
    .getByRole("button", { name: "Soumettre pour décision" })
    .click();

  const pending = page.locator("article").filter({ hasText: marker }).last();
  await pending
    .getByLabel("Motif de décision")
    .fill("Réponse vérifiée, sans publication ni envoi automatique.");
  await pending.getByRole("button", { name: "Approuver sans publier" }).click();
  const approved = page.locator("article").filter({ hasText: marker }).last();
  await expect(approved.getByText("Approuvée, non publiée")).toBeVisible();
  await expect(
    approved.getByRole("button", { name: /Publier|Envoyer la réponse/i }),
  ).toHaveCount(0);
});

test("Competitor Intelligence compares manual public evidence without crawling", async ({
  page,
}) => {
  await openDemo(page);
  await page.getByRole("link", { name: "Veille concurrents" }).click();
  await expect(
    page.getByRole("heading", { name: "Veille concurrentielle" }),
  ).toBeVisible();
  const marker = `Concurrent Playwright ${Date.now()}`;
  await page.getByLabel("Nom du concurrent").fill(marker);
  await page
    .getByLabel("Site public HTTPS, facultatif")
    .fill("https://competitor-playwright.test/");
  await page.getByRole("button", { name: "Ajouter le concurrent" }).click();
  await expect(
    page.getByText("Concurrent ajouté sans collecte externe."),
  ).toBeVisible();

  await page.getByLabel("Catégorie").selectOption("price");
  await page.getByLabel("Évolution déclarée").selectOption("decrease");
  await page.getByLabel("Type de source publique").selectOption("official_website");
  await page
    .getByLabel("URL publique HTTPS")
    .fill("https://competitor-playwright.test/pricing");
  await page.getByLabel("Titre factuel").fill("Baisse de prix publique");
  await page.getByLabel("Valeur observée, facultative").fill("95 EUR");
  await page
    .getByLabel("Résumé factuel")
    .fill("La page tarifaire publique affiche un forfait à 95 euros.");
  await page
    .getByLabel(/source publique légalement accessible/)
    .check();
  await page
    .getByLabel(/aucun contenu protégé, privé/)
    .check();
  await page.getByRole("button", { name: "Enregistrer l'observation" }).click();
  await expect(page.getByText("Observation publique enregistrée.")).toBeVisible();
  await page.getByRole("button", { name: "Comparer les observations" }).click();
  await expect(page.getByText(/Comparaison terminée/)).toBeVisible();

  const insight = page.locator("article").filter({ hasText: marker }).last();
  await expect(insight.getByText("Preuves comparées", { exact: true })).toBeVisible();
  await expect(insight.getByText(/seconde observation publique indépendante/)).toBeVisible();
  await insight.getByRole("button", { name: "Soumettre pour décision" }).click();
  const pending = page.locator("article").filter({ hasText: marker }).last();
  await pending
    .getByLabel("Motif de décision")
    .fill("Observation conservée pour planification interne uniquement.");
  await pending
    .getByRole("button", { name: "Approuver pour planification" })
    .click();
  const approved = page.locator("article").filter({ hasText: marker }).last();
  await expect(approved.getByText("Approuvée pour planification")).toBeVisible();
  await expect(
    approved.getByRole("button", { name: /Contacter|Publier|Lancer|Scraper/i }),
  ).toHaveCount(0);
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

test("the private automation library removes values and never executes a package", async ({
  page,
}) => {
  await openDemo(page);
  await page.goto("/catalogue");
  const refresh = page.getByRole("button", { name: "Actualiser le catalogue" });
  if (await refresh.count()) await refresh.click();

  await page.goto("/bibliotheque-automatisations");
  await expect(
    page.getByRole("heading", { name: "Bibliothèque d'automatisations" }),
  ).toBeVisible();
  const source = page.locator("article").filter({
    hasText: "Suivi automatique des nouveaux leads site",
  }).first();
  const prepare = source.getByRole("button", { name: "Préparer le paquet privé" });
  if (await prepare.count()) await prepare.click();

  const automationPackage = page.locator("article").filter({
    hasText: "Modèle privé déclenché par lead.created",
  });
  await expect(automationPackage.getByText("valeurs source exclues")).toBeVisible();
  const preview = automationPackage.getByRole("button", {
    name: "Prévisualiser le paquet",
  });
  if (await preview.count()) await preview.click();
  await expect(
    automationPackage.getByText("Aperçu du paquet prêt, exécution désactivée"),
  ).toBeVisible();
  await expect(
    automationPackage.getByRole("button", {
      name: /Exécuter|Activer|Installer|Publier|Envoyer|Partager publiquement/i,
    }),
  ).toHaveCount(0);
});

test("Self Improvement explains a measured issue without changing operations", async ({
  page,
}) => {
  await openDemo(page);
  const db = await getDb();
  const demo = await db.query<{ tenant_id: string }>(
    "select id as tenant_id from tenants where slug = $1 limit 1",
    ["garage-caraibes-auto"],
  );
  const tenantId = demo.rows[0]?.tenant_id;
  if (!tenantId) throw new Error("Le tenant de démonstration est introuvable.");
  await db.query(
    `update connectors set status = 'Connecté', health = 'error', updated_at = $1
     where tenant_id = $2 and connector_key = 'mock_business'`,
    [new Date().toISOString(), tenantId],
  );
  const before = await db.query<{ runs: number; activities: number; events: number }>(
    `select
       (select count(*)::int from workflow_runs where tenant_id = $1) as runs,
       (select count(*)::int from activities where tenant_id = $1) as activities,
       (select count(*)::int from domain_events where tenant_id = $1) as events`,
    [tenantId],
  );

  await page.goto("/ameliorations");
  await expect(
    page.getByRole("heading", { name: "Amélioration continue" }),
  ).toBeVisible();
  await expect(page.getByText("Mesure indisponible", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Analyser les signaux mesurés" }).click();
  const proposal = page.locator("article").filter({ hasText: "mock_business" });
  await expect(proposal.getByText("Preuves mesurées", { exact: true })).toBeVisible();
  await proposal
    .getByLabel("Motif de décision")
    .fill("Contrôle du connecteur planifié sans activation automatique.");
  await proposal.getByRole("button", { name: "Retenir pour planification" }).click();
  await expect(proposal.getByText(/Retenue pour planification/)).toBeVisible();
  await expect(
    proposal.getByRole("button", {
      name: /Activer|Synchroniser|Exécuter|Publier|Envoyer|Fusionner/i,
    }),
  ).toHaveCount(0);

  const after = await db.query<{ runs: number; activities: number; events: number }>(
    `select
       (select count(*)::int from workflow_runs where tenant_id = $1) as runs,
       (select count(*)::int from activities where tenant_id = $1) as activities,
       (select count(*)::int from domain_events where tenant_id = $1) as events`,
    [tenantId],
  );
  expect(after.rows[0]).toEqual(before.rows[0]);
});

test("operational health distinguishes measured incidents from unknown telemetry", async ({
  page,
}) => {
  await openDemo(page);
  const db = await getDb();
  const demo = await db.query<{ tenant_id: string }>(
    "select id as tenant_id from tenants where slug = $1 limit 1",
    ["garage-caraibes-auto"],
  );
  const tenantId = demo.rows[0]?.tenant_id;
  if (!tenantId) throw new Error("Le tenant de démonstration est introuvable.");
  await db.query(
    `update connectors set status = 'Connecté', health = 'error', updated_at = $1
     where tenant_id = $2 and connector_key = 'mock_business'`,
    [new Date().toISOString(), tenantId],
  );

  await page.goto("/sante-operationnelle");
  await expect(
    page.getByRole("heading", { name: "Santé opérationnelle" }),
  ).toBeVisible();
  const connectors = page.locator("article").filter({ hasText: "Connecteurs" });
  await expect(connectors.getByText("Action requise", { exact: true })).toBeVisible();
  const workers = page.locator("article").filter({ hasText: "Agents de traitement" });
  await expect(
    workers.locator("span").filter({ hasText: /^Non instrumenté$/ }),
  ).toBeVisible();
  await expect(page.getByText("Aucun état sain n'est supposé")).toHaveCount(0);
  await expect(
    page.getByRole("button", {
      name: /Redémarrer|Corriger|Exécuter|Activer|Synchroniser/i,
    }),
  ).toHaveCount(0);
});

async function openDemo(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Ouvrir la d.mo/i }).click();
  await expect(page).toHaveURL(/aujourdhui/);
}
