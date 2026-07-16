import ExcelJS from "exceljs";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import {
  importFileSizeLimit,
  parseImportFile,
} from "../src/modules/imports";

const opened: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("imports universels contrôlés", () => {
  it("valide un CSV sans écriture, détecte les erreurs puis finalise et annule", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const owner = await services.registerUser({
      name: "Import Owner",
      email: "import-owner@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: "Import Atelier",
      category: "Commerce",
    });
    const buffer = Buffer.from(
      [
        "nom,email,telephone",
        "Alice,alice@example.com,+596696000001",
        "Alice bis,alice@example.com,+596696000002",
        "Invalide,pas-un-email,+596696000003",
      ].join("\n"),
    );

    const preview = await services.previewUniversalImport(owner.id, tenant.id, {
      entityType: "contacts",
      format: "csv",
      fileName: "contacts.csv",
      contentType: "text/csv",
      mapping: { name: "nom", email: "email", phone: "telephone" },
      buffer,
    });
    expect(preview).toMatchObject({
      status: "validated",
      report: { total: 3, valid: 1, duplicates: 1, invalid: 1, imported: 0 },
    });
    const beforeCommit = await db.query<{ count: number | string }>(
      "select count(*) as count from contacts where tenant_id = $1",
      [tenant.id],
    );
    expect(Number(beforeCommit.rows[0]?.count)).toBe(0);

    const committed = await services.commitUniversalImportBatch(
      owner.id,
      tenant.id,
      { importId: preview.id, batchSize: 1 },
    );
    expect(committed).toMatchObject({
      status: "completed",
      remaining: 0,
      report: { imported: 1, duplicates: 1, invalid: 1 },
    });
    const imported = await db.query<{ email: string; phone: string }>(
      "select email, phone from contacts where tenant_id = $1",
      [tenant.id],
    );
    expect(imported.rows).toEqual([
      { email: "alice@example.com", phone: "+596696000001" },
    ]);

    await expect(
      services.rollbackUniversalImport(owner.id, tenant.id, preview.id),
    ).resolves.toMatchObject({ status: "rolled_back" });
    const afterRollback = await db.query<{ count: number | string }>(
      "select count(*) as count from contacts where tenant_id = $1",
      [tenant.id],
    );
    expect(Number(afterRollback.rows[0]?.count)).toBe(0);
  });

  it("importe les entreprises, produits et opportunités avec leurs références tenant", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const owner = await services.registerUser({
      name: "Entity Owner",
      email: "entity-owner@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: "Entity Atelier",
      category: "Services",
    });

    const contact = await previewAndCommit(services, owner.id, tenant.id, {
      entityType: "contacts",
      fileName: "contact.json",
      mapping: { name: "nom", email: "email" },
      rows: [{ nom: "Client Référence", email: "reference@example.com" }],
    });
    expect(contact.report.imported).toBe(1);
    const company = await previewAndCommit(services, owner.id, tenant.id, {
      entityType: "companies",
      fileName: "entreprise.json",
      mapping: { name: "nom", domain: "domaine" },
      rows: [{ nom: "Société Démo", domaine: "https://societe.example.test/page" }],
    });
    const product = await previewAndCommit(services, owner.id, tenant.id, {
      entityType: "products",
      fileName: "produit.json",
      mapping: { name: "nom", sku: "reference", price: "prix" },
      rows: [{ nom: "Prestation", reference: "srv-001", prix: "149,90" }],
    });
    const opportunity = await previewAndCommit(services, owner.id, tenant.id, {
      entityType: "opportunities",
      fileName: "opportunite.json",
      mapping: {
        contact_email: "email_contact",
        stage_name: "etape",
        value: "valeur",
      },
      rows: [{
        email_contact: "reference@example.com",
        etape: "Nouveau contact",
        valeur: "2500",
      }],
    });
    expect([company, product, opportunity].map((result) => result.report.imported)).toEqual([
      1,
      1,
      1,
    ]);
    const rows = await db.query<{ price_cents: number }>(
      "select price_cents from products where tenant_id = $1",
      [tenant.id],
    );
    expect(Number(rows.rows[0]?.price_cents)).toBe(14_990);
    const opportunities = await db.query<{ value_cents: number }>(
      "select value_cents from opportunities where tenant_id = $1",
      [tenant.id],
    );
    expect(Number(opportunities.rows[0]?.value_cents)).toBe(250_000);
  });

  it("refuse taille, CSV malformé, formules, JSON profond et accès inter-tenant", async () => {
    await expect(
      parseImportFile({
        buffer: Buffer.alloc(importFileSizeLimit + 1, "a"),
        format: "csv",
        contentType: "text/csv",
      }),
    ).rejects.toMatchObject({ code: "file_too_large" });

    await expect(
      parseImportFile({
        buffer: Buffer.from('nom,email\n"Valeur non terminée,test@example.com'),
        format: "csv",
        contentType: "text/csv",
      }),
    ).rejects.toMatchObject({ code: "malformed_csv" });

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Contacts");
    sheet.addRow(["nom", "email"]);
    sheet.addRow([
      { formula: "HYPERLINK(\"https://example.test\")", result: "Lien" },
      "x@example.com",
    ]);
    const xlsx = Buffer.from(await workbook.xlsx.writeBuffer());
    await expect(
      parseImportFile({
        buffer: xlsx,
        format: "xlsx",
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    ).rejects.toMatchObject({ code: "spreadsheet_formula_not_allowed" });

    const deep = Buffer.from(JSON.stringify([deepObject(10)]));
    await expect(
      parseImportFile({ buffer: deep, format: "json", contentType: "application/json" }),
    ).rejects.toMatchObject({ code: "json_too_deep" });

    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const first = await services.registerUser({
      name: "First Owner",
      email: "first-import@example.com",
      password: "Password!1",
    });
    const second = await services.registerUser({
      name: "Second Owner",
      email: "second-import@example.com",
      password: "Password!1",
    });
    const firstTenant = await services.createTenant(first.id, {
      name: "First Import",
      category: "Services",
    });
    const secondTenant = await services.createTenant(second.id, {
      name: "Second Import",
      category: "Services",
    });
    const preview = await services.previewUniversalImport(first.id, firstTenant.id, {
      entityType: "contacts",
      format: "json",
      fileName: "tenant.json",
      contentType: "application/json",
      mapping: { name: "nom", email: "email" },
      buffer: Buffer.from(JSON.stringify([{ nom: "Tenant", email: "tenant@example.com" }])),
    });
    await expect(
      services.commitUniversalImportBatch(second.id, secondTenant.id, {
        importId: preview.id,
      }),
    ).rejects.toMatchObject({ code: "import_not_found" });
  });
});

async function previewAndCommit(
  services: ReturnType<typeof createServices>,
  userId: string,
  tenantId: string,
  input: {
    entityType: "contacts" | "companies" | "products" | "opportunities";
    fileName: string;
    mapping: Record<string, string>;
    rows: Array<Record<string, string>>;
  },
) {
  const preview = await services.previewUniversalImport(userId, tenantId, {
    entityType: input.entityType,
    format: "json",
    fileName: input.fileName,
    contentType: "application/json",
    mapping: input.mapping,
    buffer: Buffer.from(JSON.stringify(input.rows)),
  });
  return services.commitUniversalImportBatch(userId, tenantId, {
    importId: preview.id,
  });
}

function deepObject(depth: number): Record<string, unknown> {
  return depth === 0 ? { value: "ok" } : { nested: deepObject(depth - 1) };
}
