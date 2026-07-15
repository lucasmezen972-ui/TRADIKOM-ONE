import ExcelJS from "exceljs";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { id, nowIso } from "../src/lib/security";
import { createServices } from "../src/lib/services";
import { formatExport } from "../src/modules/exports";
import { processPendingDomainEvents } from "../src/modules/workflows/worker";

const opened: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("exports universels contrôlés", () => {
  it("génère un CSV durable, neutralise les formules et expire le téléchargement", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const owner = await services.registerUser({
      name: "Export Owner",
      email: "export-owner@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: "Export Atelier",
      category: "Commerce",
    });
    const now = nowIso();
    await db.query(
      `insert into contacts (
         id, tenant_id, name, email, phone, status, source, tags,
         assigned_user_id, created_at, updated_at
       ) values ($1, $2, $3, $4, '', 'Nouveau', 'test', '[]', $5, $6, $6)`,
      [id("contact"), tenant.id, "=CMD()", "exported@example.com", owner.id, now],
    );

    const job = await services.createUniversalExport(owner.id, tenant.id, {
      entityType: "contacts",
      format: "csv",
      selectedFields: ["name", "email"],
      dateFrom: "2026-01-01T00:00:00.000Z",
      dateTo: "2026-12-31T23:59:59.999Z",
    });
    expect(job.status).toBe("queued");
    const before = await db.query<{ safe_content: string | null }>(
      "select safe_content from export_jobs where tenant_id = $1 and id = $2",
      [tenant.id, job.id],
    );
    expect(before.rows[0]?.safe_content).toBeNull();

    const worker = await processPendingDomainEvents(db, { limit: 25 });
    expect(worker.succeeded).toBeGreaterThan(0);
    const workspace = await services.getExportWorkspace(owner.id, tenant.id);
    expect(workspace.jobs[0]).toMatchObject({
      id: job.id,
      status: "completed",
      rowCount: 1,
    });
    const download = await services.getUniversalExportDownload(
      owner.id,
      tenant.id,
      job.id,
    );
    const csv = download.content.toString("utf8");
    expect(csv).toContain("'=CMD()");
    expect(csv).toContain("exported@example.com");
    expect(csv).not.toContain(owner.id);
    expect(download.fileName).toMatch(/^tradikom-contacts-\d{4}-\d{2}-\d{2}\.csv$/);

    await db.query(
      "update export_jobs set expires_at = $1 where tenant_id = $2 and id = $3",
      ["2000-01-01T00:00:00.000Z", tenant.id, job.id],
    );
    await expect(
      services.getUniversalExportDownload(owner.id, tenant.id, job.id),
    ).rejects.toMatchObject({ code: "export_expired" });
    const expired = await db.query<{ status: string; safe_content: string | null }>(
      "select status, safe_content from export_jobs where tenant_id = $1 and id = $2",
      [tenant.id, job.id],
    );
    expect(expired.rows[0]).toEqual({ status: "expired", safe_content: null });
  });

  it("produit des JSON et XLSX bornés sans formule exécutable", async () => {
    const rows = [{ name: "@SUM(A1:A2)", email: "safe@example.com" }];
    const json = await formatExport({
      entityType: "contacts",
      format: "json",
      selectedFields: ["name", "email"],
      rows,
    });
    expect(JSON.parse(json.content.toString("utf8"))).toEqual(rows);

    const xlsx = await formatExport({
      entityType: "contacts",
      format: "xlsx",
      selectedFields: ["name", "email"],
      rows,
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Uint8Array.from(xlsx.content).buffer);
    expect(workbook.worksheets[0]?.getCell("A2").value).toBe("'@SUM(A1:A2)");
    expect(workbook.worksheets[0]?.getCell("B2").value).toBe("safe@example.com");
  });

  it("refuse les champs inconnus, isole les tenants et honore l'annulation avant worker", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const ownerA = await services.registerUser({
      name: "Export A",
      email: "export-a@example.com",
      password: "Password!1",
    });
    const ownerB = await services.registerUser({
      name: "Export B",
      email: "export-b@example.com",
      password: "Password!1",
    });
    const tenantA = await services.createTenant(ownerA.id, {
      name: "Export A",
      category: "Services",
    });
    const tenantB = await services.createTenant(ownerB.id, {
      name: "Export B",
      category: "Services",
    });
    const base = {
      entityType: "contacts" as const,
      format: "csv" as const,
      dateFrom: "2026-01-01T00:00:00.000Z",
      dateTo: "2026-12-31T23:59:59.999Z",
    };
    await expect(
      services.createUniversalExport(ownerA.id, tenantA.id, {
        ...base,
        selectedFields: ["password_hash"],
      }),
    ).rejects.toMatchObject({ code: "export_field_not_allowed" });

    const job = await services.createUniversalExport(ownerA.id, tenantA.id, {
      ...base,
      selectedFields: ["name"],
    });
    await expect(
      services.getUniversalExportDownload(ownerB.id, tenantB.id, job.id),
    ).rejects.toMatchObject({ code: "export_not_found" });
    await services.cancelUniversalExport(ownerA.id, tenantA.id, job.id);
    await processPendingDomainEvents(db, { limit: 25 });
    const workspace = await services.getExportWorkspace(ownerA.id, tenantA.id);
    expect(workspace.jobs[0]).toMatchObject({
      id: job.id,
      status: "cancelled",
      rowCount: 0,
    });
    const stored = await db.query<{ safe_content: string | null }>(
      "select safe_content from export_jobs where tenant_id = $1 and id = $2",
      [tenantA.id, job.id],
    );
    expect(stored.rows[0]?.safe_content).toBeNull();
  });
});
