import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb, type DbClient } from "../src/lib/db";
import { safeJson } from "../src/lib/security";
import { createServices } from "../src/lib/services";
import { reviseAiEmployeeProfile } from "../src/modules/ai-employees";

const opened: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("AI Employee module", () => {
  it("provisions nine bounded profiles with memory, limits and immutable revisions", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const owner = await services.registerUser({
      name: "AI Team Owner",
      email: "ai-team-owner@example.com",
      password: "Password!1",
    });
    const outsider = await services.registerUser({
      name: "AI Team Outsider",
      email: "ai-team-outsider@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: "AI Team Garage",
      category: "Garage automobile",
    });
    await services.createBusinessBrainEntry(owner.id, tenant.id, {
      domain: "margins",
      title: "Marge mensuelle suivie",
      summary: "La marge mensuelle est contrôlée par la direction.",
      details: "",
      confidence: 90,
      sourceType: "manual",
      evidenceType: "document",
      evidenceSummary: "Revue financière interne validée.",
    });

    let workspace = await services.getAiEmployeeWorkspace(owner.id, tenant.id);
    expect(workspace.employees).toHaveLength(9);
    expect(workspace.activities).toHaveLength(9);
    expect(new Set(workspace.employees.map((employee) => employee.role)).size).toBe(9);
    for (const employee of workspace.employees) {
      expect(employee.skills.length).toBeGreaterThan(0);
      expect(employee.permissions.length).toBeGreaterThan(0);
      expect(employee.tools.length).toBeGreaterThan(0);
      expect(employee.kpis.length).toBeGreaterThan(0);
      expect(employee.workingHours).toMatchObject({
        start: "08:00",
        end: "17:00",
        workingDays: [1, 2, 3, 4, 5],
      });
      expect(employee.approvalLimits).toEqual({
        internalDrafts: "approval_required",
        externalCommunications: "prohibited",
        productionWrites: "prohibited",
        financialTransactions: "prohibited",
        connectorActivation: "prohibited",
      });
      expect(employee.permissions.every((permission) =>
        permission.access === "read" || permission.approvalRequired,
      )).toBe(true);
      expect(employee.tools.every((tool) =>
        tool.mode === "read_only" || tool.mode === "draft_only",
      )).toBe(true);
    }
    const analyst = workspace.employees.find(
      (employee) => employee.role === "business_analyst",
    );
    if (!analyst) throw new Error("Business analyst fixture is missing.");
    expect(analyst.memory).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ domain: "margins", title: "Marge mensuelle suivie" }),
      ]),
    );
    const operationalBefore = await countOperationalEffects(db, tenant.id);
    const revised = await services.reviseAiEmployeeProfile(owner.id, tenant.id, {
      employeeId: analyst.id,
      displayName: "Analyste de pilotage IA",
      purpose: "Préparer des synthèses internes vérifiables pour la revue de direction.",
      status: "paused",
      workingDays: [1, 2, 3, 4],
      workdayStart: "09:00",
      workdayEnd: "16:00",
    });
    expect(revised.version).toBe(2);
    workspace = await services.getAiEmployeeWorkspace(owner.id, tenant.id);
    const paused = workspace.employees.find(
      (employee) => employee.role === "business_analyst",
    );
    expect(paused).toMatchObject({
      displayName: "Analyste de pilotage IA",
      status: "paused",
      version: 2,
      workingHours: {
        workingDays: [1, 2, 3, 4],
        start: "09:00",
        end: "16:00",
      },
    });
    expect(workspace.activities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          employeeKey: "business-analyst",
          type: "paused",
        }),
      ]),
    );
    expect(await countOperationalEffects(db, tenant.id)).toEqual(operationalBefore);

    const history = await db.query<{ record_status: string; version: number }>(
      `select record_status, version from ai_employee_profiles
       where tenant_id = $1 and employee_key = 'business-analyst'
       order by version`,
      [tenant.id],
    );
    expect(history.rows).toEqual([
      { record_status: "superseded", version: 1 },
      { record_status: "current", version: 2 },
    ]);
    const audit = await db.query<{ safe_metadata: string }>(
      `select safe_metadata from audit_logs
       where tenant_id = $1 and action = 'ai_employee.profile_revised'
       order by created_at desc limit 1`,
      [tenant.id],
    );
    expect(safeJson(audit.rows[0]?.safe_metadata, {})).toMatchObject({
      employeeKey: "business-analyst",
      version: 2,
      status: "paused",
      externalExecutionEnabled: false,
    });
    expect(await services.initializeAiEmployeeTeam(owner.id, tenant.id)).toEqual({
      createdIds: [],
    });
    await expect(
      services.getAiEmployeeWorkspace(outsider.id, tenant.id),
    ).rejects.toThrow("Acces refuse");
    await expect(
      services.reviseAiEmployeeProfile(outsider.id, tenant.id, {
        employeeId: paused!.id,
        displayName: "Profil interdit",
        purpose: "Cette modification inter-tenant doit être refusée.",
        status: "enabled",
        workingDays: [1],
        workdayStart: "09:00",
        workdayEnd: "10:00",
      }),
    ).rejects.toThrow("Acces refuse");
  });

  it("rolls back a profile revision when activity persistence fails", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const owner = await services.registerUser({
      name: "AI Team Rollback",
      email: "ai-team-rollback@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: "AI Team Rollback Garage",
      category: "Garage automobile",
    });
    const workspace = await services.getAiEmployeeWorkspace(owner.id, tenant.id);
    const employee = workspace.employees[0];
    if (!employee) throw new Error("AI employee rollback fixture is missing.");
    const failingDb: DbClient = {
      query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => {
        if (sql.includes("insert into ai_employee_activity_logs")) {
          throw new Error("injected AI employee activity failure");
        }
        return db.query<T>(sql, params);
      },
    };

    await expect(
      reviseAiEmployeeProfile(failingDb, owner.id, tenant.id, {
        employeeId: employee.id,
        displayName: "Profil transactionnel",
        purpose: "Cette révision doit être entièrement annulée en cas d'échec.",
        status: "paused",
        workingDays: [1, 2, 3],
        workdayStart: "09:00",
        workdayEnd: "15:00",
      }),
    ).rejects.toThrow("injected AI employee activity failure");
    const rows = await db.query<{ record_status: string; version: number }>(
      `select record_status, version from ai_employee_profiles
       where tenant_id = $1 and employee_key = $2 order by version`,
      [tenant.id, employee.employeeKey],
    );
    expect(rows.rows).toEqual([{ record_status: "current", version: 1 }]);
  });
});

async function countOperationalEffects(
  db: Awaited<ReturnType<typeof createMemoryDb>>,
  tenantId: string,
) {
  const result = await db.query<{
    activities: number | string;
    domain_events: number | string;
    notifications: number | string;
    website_versions: number | string;
  }>(
    `select
       (select count(*) from activities where tenant_id = $1) as activities,
       (select count(*) from domain_events where tenant_id = $1) as domain_events,
       (select count(*) from notifications where tenant_id = $1) as notifications,
       (select count(*) from website_versions where tenant_id = $1) as website_versions`,
    [tenantId],
  );
  return {
    activities: Number(result.rows[0]?.activities ?? 0),
    domainEvents: Number(result.rows[0]?.domain_events ?? 0),
    notifications: Number(result.rows[0]?.notifications ?? 0),
    websiteVersions: Number(result.rows[0]?.website_versions ?? 0),
  };
}
