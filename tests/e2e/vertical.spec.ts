import { expect, test } from "@playwright/test";

test("demo user can publish site lead into CRM", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: /Ouvrir la demo/i }).click();
  await expect(page).toHaveURL(/aujourdhui/);

  await page.getByRole("link", { name: "Mon site" }).click();
  await expect(page.getByRole("heading", { name: /Site Garage/i })).toBeVisible();
  await page.getByRole("link", { name: /Voir le site/i }).click();
  await expect(page).toHaveURL(/sites\/garage-caraibes-auto/);

  await page.getByPlaceholder("Votre nom").fill("Lead Playwright");
  await page.getByPlaceholder("Email").fill("lead-playwright@example.com");
  await page.getByPlaceholder("Telephone").fill("+596 696 12 12 12");
  await page.getByPlaceholder("Votre demande").fill("Je souhaite prendre rendez-vous.");
  await page.getByRole("button", { name: /Envoyer/i }).click();
  await expect(page).toHaveURL(/merci/);

  await page.goto("/contacts");
  await expect(page.getByText("lead-playwright@example.com")).toBeVisible();
  await expect(page.getByText(/Relancer le nouveau lead/i).first()).toBeVisible();
});
