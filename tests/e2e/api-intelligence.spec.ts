import { readFile } from "node:fs/promises";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { closeDb, getDb } from "../../src/lib/db";
import { createServices } from "../../src/lib/services";
import { setPlatformRole } from "../../src/modules/platform-admin";

test("un administrateur publie un connecteur desactive dans le Connect Store prive", async ({
  page,
}) => {
  const nonce = Date.now().toString(36);
  const email = `api-intelligence-${nonce}@example.com`;
  const password = "Password!1";
  const domain = `docs-${nonce}.garage-cloud.test`;
  const connectorName = `Garage Cloud E2E ${nonce}`;
  const openApi = await readFile(
    path.join(process.cwd(), "tests", "fixtures", "mock-garage-openapi.json"),
    "utf8",
  );
  const db = await getDb();
  const services = createServices(db, {
    discoveryTransport: async (url) =>
      url.pathname === "/robots.txt"
        ? {
            status: 200,
            headers: { "content-type": "text/plain" },
            body: "User-agent: TradikomApiScout\nAllow: /",
          }
        : {
            status: 200,
            headers: {
              "content-type": "application/json",
              etag: `"${nonce}"`,
            },
            body: openApi,
          },
    mockContractExecutor: async () => ({
      status: 200,
      body: { fixture: true },
    }),
  });

  const user = await services.registerUser({
    name: "Administrateur API E2E",
    email,
    password,
  });
  const tenant = await services.createTenant(user.id, {
    name: `Garage API E2E ${nonce}`,
    category: "Garage automobile",
  });
  await setPlatformRole(db, user.id, "platform_admin");
  const software = await services.createSoftwareDirectoryEntry(
    user.id,
    tenant.id,
    {
      canonicalName: `Garage Cloud ${nonce}`,
      aliases: [],
      vendor: "Garage Cloud SAS",
      officialDomain: domain,
      supportedRegions: ["Europe"],
      languages: ["fr"],
      industries: ["Automobile"],
      categories: ["Gestion de garage"],
      officialWebsite: `https://${domain}/`,
    },
  );
  await services.decideSoftwareDomain(user.id, tenant.id, {
    domainId: software.domainId,
    status: "approved",
    reason: "Domaine fixture verifie.",
  });
  const product = await services.createApiProductRecord(user.id, tenant.id, {
    softwareId: software.softwareId,
    name: `Garage Cloud API ${nonce}`,
    apiStyle: "rest",
    version: nonce,
    documentationUrl: `https://${domain}/openapi.json`,
  });
  const source = await services.addOfficialApiSource(user.id, tenant.id, {
    softwareId: software.softwareId,
    apiProductId: product.apiProductId,
    url: `https://${domain}/openapi.json`,
    sourceType: "official_openapi_specification",
  });
  const snapshot = await services.fetchApprovedApiSource(
    user.id,
    tenant.id,
    source.sourceId,
  );
  const preview = await services.previewOpenApiSnapshot(user.id, tenant.id, {
    snapshotId: snapshot.id,
    apiProductId: product.apiProductId,
  });
  const imported = await services.persistOpenApiPreview(
    user.id,
    tenant.id,
    preview,
  );
  for (const claimId of imported.claimIds) {
    await services.decideApiClaim(user.id, tenant.id, {
      claimId,
      status: "approved",
      reason: "Preuve fixture verifiee.",
    });
  }
  const customerEvidence = imported.schemaEvidence.Customer;
  if (!customerEvidence) throw new Error("Preuve Customer absente.");
  const mapping = await services.proposeTenantOntologyMapping(
    user.id,
    tenant.id,
    {
      apiProductId: product.apiProductId,
      sourceEntity: "Customer",
      canonicalEntity: "Contact",
      confidence: 95,
      evidenceId: customerEvidence,
    },
  );
  await services.decideTenantOntologyMapping(user.id, tenant.id, {
    mappingId: mapping.mappingId,
    status: "approved",
  });
  const compatibility = await services.runCompatibilityCheck(
    user.id,
    tenant.id,
    {
      softwareId: software.softwareId,
      apiProductId: product.apiProductId,
      tenantIndustry: tenant.category,
      desiredAutomation: "Synchroniser les clients vers les contacts.",
    },
  );
  const proposal = await services.generateConnectorProposal(
    user.id,
    tenant.id,
    {
      compatibilityCheckId: compatibility.checkId,
      name: connectorName,
    },
  );
  await services.runMockContractTests(user.id, tenant.id, proposal.proposalId);
  const approval = await services.submitConnectorForSandboxApproval(
    user.id,
    tenant.id,
    proposal.proposalId,
  );
  await services.decideConnectorSandboxApproval(user.id, tenant.id, {
    approvalId: approval.approvalId,
    decision: "approved",
    reason: "Validation sandbox E2E.",
  });
  await closeDb();

  await page.goto("/");
  const login = page.locator("form").filter({ hasText: "Se connecter" });
  await login.getByPlaceholder("Email professionnel").fill(email);
  await login.getByPlaceholder("Mot de passe").fill(password);
  await login.getByRole("button", { name: "Se connecter" }).click();
  await expect(page).toHaveURL(/aujourdhui/);

  await page.goto("/intelligence-api");
  await expect(
    page.getByRole("heading", { name: "Intelligence API" }),
  ).toBeVisible();
  const storeCard = page.locator("article").filter({ hasText: connectorName });
  await expect(storeCard).toContainText("Sandbox uniquement");
  await expect(storeCard).toContainText("Désactivée");

  await page.goto("/connexions");
  await expect(page.getByRole("heading", { name: "Plans de connexion" })).toBeVisible();
  const planningCard = page.locator("article").filter({ hasText: connectorName });
  await expect(planningCard.getByText("adéquation documentée")).toBeVisible();
  await expect(planningCard.getByText(/2 opérations · 1 correspondances/)).toBeVisible();
  await expect(planningCard.getByText("createCustomer · écriture avec approbation")).toBeVisible();
  await planningCard
    .getByRole("button", { name: "Préparer le plan sandbox" })
    .click();
  await expect(planningCard.getByText("Plan v1 prêt, désactivé")).toBeVisible();
  await expect(
    planningCard.getByRole("button", {
      name: /Activer|Installer|Connecter en production/i,
    }),
  ).toHaveCount(0);

  await page.goto("/catalogue");
  await expect(page.getByRole("heading", { name: "Catalogue privé" })).toBeVisible();
  await page.getByRole("button", { name: "Actualiser le catalogue" }).click();
  const marketplaceCard = page.locator("article").filter({ hasText: connectorName });
  await expect(marketplaceCard.getByText("Connecteur", { exact: true })).toBeVisible();
  await expect(marketplaceCard).toContainText("Plan connecteur sandbox validé");
  await marketplaceCard
    .getByRole("button", { name: "Prévisualiser l'installation" })
    .click();
  await expect(
    marketplaceCard.getByText("Aperçu d'installation prêt, désactivé"),
  ).toBeVisible();
  await expect(
    marketplaceCard.getByRole("button", {
      name: /Activer|Installer|Exécuter|Publier|Payer/i,
    }),
  ).toHaveCount(0);
});
