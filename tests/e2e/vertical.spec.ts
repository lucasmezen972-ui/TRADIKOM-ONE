import { expect, test, type Page } from "@playwright/test";

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
    .locator("form")
    .filter({ hasText: "publication" });
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

async function openDemo(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /Ouvrir la d.mo/i }).click();
  await expect(page).toHaveURL(/aujourdhui/);
}
