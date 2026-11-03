import ExcelJS from "exceljs";
import { afterEach, expect, it } from "vitest";
import type { SqlTransactionContext } from "../src/db/client";
import { createMemoryDb, migrate, type DbClient } from "../src/lib/db";
import { id, nowIso } from "../src/lib/security";
import { createServices } from "../src/lib/services";

const opened: Array<{ close: () => Promise<void> }> = [];
afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

async function setup() {
  const db = await createMemoryDb();
  opened.push(db);
  const services = createServices(db);
  const owner = await services.registerUser({ name: "Export explicite", email: "export-explicit@example.test", password: "FixturePassword!1" });
  const outsider = await services.registerUser({ name: "Autre export", email: "export-foreign@example.test", password: "FixturePassword!1" });
  const collaborator = await services.registerUser({ name: "Collaborateur", email: "export-collaborator@example.test", password: "FixturePassword!1" });
  const tenant = await services.createTenant(owner.id, { name: "Export choisi", category: "Services" });
  const foreign = await services.createTenant(outsider.id, { name: "Export tiers", category: "Services" });
  await db.query("insert into memberships (tenant_id, user_id, role, created_at) values ($1, $2, 'collaborator', $3)", [tenant.id, collaborator.id, nowIso()]);
  await db.query(`insert into contacts (id, tenant_id, name, email, phone, status, source, tags, assigned_user_id, created_at, updated_at)
    values ($1, $2, '=CMD()', 'selected@example.test', 'private-phone', 'Nouveau', 'test', '[]', $3, $4, $4),
           ($5, $6, 'Contact tiers', 'foreign@example.test', '', 'Nouveau', 'test', '[]', $7, $4, $4)`,
  [id("contact"), tenant.id, owner.id, nowIso(), id("contact"), foreign.id, outsider.id]);
  await migrate(db, { enableRls: true });
  await db.exec(`create role export_generation_runtime;
    grant usage on schema public to export_generation_runtime;
    grant select, insert, update, delete on all tables in schema public to export_generation_runtime;
    set role export_generation_runtime`);
  const statements: string[] = [];
  const contexts: SqlTransactionContext[] = [];
  const runtime = {
    __runtime: "postgres",
    query: (sql: string, params?: unknown[]) => db.query(sql, params),
    __withTransaction: (context: SqlTransactionContext, callback: (tx: DbClient) => Promise<unknown>) => db.transaction(async (tx) => {
      contexts.push(context);
      if (context.tenantId) await tx.query("select set_config('app.tenant_id', $1, true)", [context.tenantId]);
      if (context.actorId) await tx.query("select set_config('app.actor_id', $1, true)", [context.actorId]);
      if (context.systemAccess) await tx.query("select set_config('app.system_access', 'true', true)");
      return callback({ __runtime: "postgres", __transaction: true, query: (sql: string, params?: unknown[]) => { statements.push(sql); return tx.query(sql, params); } } as DbClient);
    }),
  } as unknown as DbClient;
  const scoped = createServices(runtime);
  const base = { entityType: "contacts" as const, selectedFields: ["name", "email"], dateFrom: "2026-01-01T00:00:00.000Z", dateTo: "2026-12-31T23:59:59.999Z" };
  return { db, runtime, scoped, owner, outsider, collaborator, tenant, foreign, base, statements, contexts };
}

it("génère seulement l’export choisi sous rôle runtime, contrôle tenant/rôle et rejoue sans doubler l’audit", async () => {
  const { db, runtime, scoped, owner, outsider, collaborator, tenant, foreign, base, contexts } = await setup();
  const selected = await scoped.createUniversalExport(owner.id, tenant.id, { ...base, format: "csv" });
  const untouched = await scoped.createUniversalExport(owner.id, tenant.id, { ...base, format: "csv" });
  await expect(scoped.generateUniversalExport(outsider.id, tenant.id, selected.id)).rejects.toMatchObject({ code: "tenant_access_denied" });
  await expect(scoped.generateUniversalExport(collaborator.id, tenant.id, selected.id)).rejects.toMatchObject({ code: "tenant_access_denied" });
  await expect(scoped.generateUniversalExport(outsider.id, foreign.id, selected.id)).rejects.toMatchObject({ code: "export_not_found" });
  await expect(scoped.generateUniversalExport(owner.id, tenant.id, "")).rejects.toThrow();
  await expect(scoped.generateUniversalExport(owner.id, tenant.id, selected.id)).resolves.toMatchObject({ status: "completed", idempotentReplay: false, rowCount: 1 });
  const csv = await scoped.getUniversalExportDownload(owner.id, tenant.id, selected.id);
  expect(csv.content.toString("utf8")).toContain("'=CMD()");
  expect(csv.content.toString("utf8")).toContain("selected@example.test");
  expect(csv.content.toString("utf8")).not.toContain("foreign@example.test");
  expect(csv.content.toString("utf8")).not.toContain("private-phone");
  await expect(scoped.generateUniversalExport(owner.id, tenant.id, selected.id)).resolves.toMatchObject({ status: "completed", idempotentReplay: true });
  await expect(scoped.processUniversalExportJob(owner.id, tenant.id, selected.id)).resolves.toMatchObject({ status: "completed", idempotentReplay: true });
  expect((await runtime.query("select * from export_jobs")).rows).toHaveLength(0);
  expect(contexts.every((context) => !context.systemAccess)).toBe(true);
  await db.exec("reset role");
  const jobs = await db.query<{ id: string; status: string }>("select id, status from export_jobs order by id");
  expect(jobs.rows).toEqual(expect.arrayContaining([{ id: selected.id, status: "completed" }, { id: untouched.id, status: "queued" }]));
  const audits = await db.query<{ count: number }>("select count(*)::int as count from audit_logs where tenant_id = $1 and target_id = $2 and action = 'export.completed'", [tenant.id, selected.id]);
  expect(audits.rows[0]?.count).toBe(1);
  const event = await db.query<{ status: string }>("select status from domain_events where tenant_id = $1 and idempotency_key = $2", [tenant.id, `export:${untouched.id}`]);
  expect(event.rows[0]?.status).toBe("pending");
});

it("préserve JSON/XLSX, expiration, annulation et verrouille les replays utilisateur/worker", async () => {
  const { db, scoped, owner, tenant, base, statements } = await setup();
  for (const format of ["json", "xlsx"] as const) {
    const job = await scoped.createUniversalExport(owner.id, tenant.id, { ...base, format });
    const results = await Promise.all([
      scoped.generateUniversalExport(owner.id, tenant.id, job.id),
      scoped.processUniversalExportJob(owner.id, tenant.id, job.id),
    ]);
    expect(results.filter((result) => result.status === "completed" && !result.idempotentReplay)).toHaveLength(1);
    expect(results.every((result) => result.status === "completed")).toBe(true);
    const file = await scoped.getUniversalExportDownload(owner.id, tenant.id, job.id);
    if (format === "json") expect(JSON.parse(file.content.toString("utf8"))).toEqual([{ name: "=CMD()", email: "selected@example.test" }]);
    else {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(Uint8Array.from(file.content).buffer);
      expect(workbook.worksheets[0]?.getCell("A2").value).toBe("'=CMD()");
      expect(workbook.worksheets[0]?.getCell("B2").value).toBe("selected@example.test");
    }
  }
  expect(statements.filter((sql) => /select \* from export_jobs/i.test(sql)).some((sql) => /for update/i.test(sql))).toBe(true);
  const expired = await scoped.createUniversalExport(owner.id, tenant.id, { ...base, format: "csv" });
  const cancelled = await scoped.createUniversalExport(owner.id, tenant.id, { ...base, format: "csv" });
  await scoped.cancelUniversalExport(owner.id, tenant.id, cancelled.id);
  await db.exec("reset role");
  await db.query("update export_jobs set expires_at = '2000-01-01T00:00:00.000Z' where id = $1", [expired.id]);
  await db.exec("set role export_generation_runtime");
  await expect(scoped.generateUniversalExport(owner.id, tenant.id, expired.id)).resolves.toMatchObject({ status: "expired" });
  await expect(scoped.generateUniversalExport(owner.id, tenant.id, cancelled.id)).resolves.toMatchObject({ status: "cancelled", idempotentReplay: true });
  await db.exec("reset role");
  const terminal = await db.query<{ status: string; safe_content: string | null }>("select status, safe_content from export_jobs where id in ($1, $2)", [expired.id, cancelled.id]);
  expect(terminal.rows).toEqual(expect.arrayContaining([{ status: "expired", safe_content: null }, { status: "cancelled", safe_content: null }]));
});
