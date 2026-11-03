import { describe, expect, it } from "vitest";
import { createMemoryDb, type DbClient } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import { defaultGarageOnboarding } from "../src/lib/generation";
import { getBusinessBrain } from "../src/modules/business-brain/service";
import { listMarketplaceSourceRows } from "../src/modules/app-marketplace/repository";
import type { SqlTransactionContext } from "../src/db/client";

type Call = { sql: string; params?: unknown[] };
function singleFlight(resolveRows: (call: Call) => unknown[]) {
  let active = false;
  const calls: Call[] = [];
  const db: DbClient = {
    async query<T>(sql: string, params?: unknown[]) {
      if (active) throw new Error("single_connection_query_overlap");
      active = true;
      try {
        const call = { sql, params };
        calls.push(call);
        await Promise.resolve();
        return { rows: resolveRows(call) as T[] };
      } finally { active = false; }
    },
  };
  return { db, calls };
}

const signals = {
  business_profile_data: null, business_profile_updated_at: null,
  contact_count: "2", opportunity_count: "1", pipeline_value_cents: "4500", member_count: "1",
  workflow_count: "1", website_count: "1", published_website_count: "0", connector_count: "0", api_asset_count: "0",
};

function brainRows({ sql }: Call) {
  if (sql.includes("select role from memberships")) return [{ role: "owner" }];
  if (sql.includes("from business_brain_evidence")) return [];
  if (sql.includes("from business_brain_entries")) return [];
  return [signals];
}

describe("transaction-owned reads are single-flight", () => {
  it("loads business brain sources serially while preserving tenant scope and signals", async () => {
    const { db, calls } = singleFlight(brainRows);
    const workspace = await getBusinessBrain(db, "user_fixture", "tenant_fixture");
    expect(workspace.entries).toEqual([]);
    expect(workspace.signals).toMatchObject({ contacts: 2, opportunities: 1, pipelineValueCents: 4500 });
    expect(calls.map(call => call.params)).toEqual([
      ["user_fixture", "tenant_fixture"], ["tenant_fixture"], ["tenant_fixture"], ["tenant_fixture"],
    ]);
    expect(calls[1].sql).toContain("source_ref is distinct from 'goal-watch:v1'");
    expect(calls[2].sql).toContain("entries.source_ref is distinct from 'goal-watch:v1'");
  });

  it("stops business brain reads immediately when the first tenant source fails", async () => {
    const calls: Call[] = [];
    const db: DbClient = { async query<T>(sql: string, params?: unknown[]) {
      calls.push({ sql, params });
      if (sql.includes("select role from memberships")) return { rows: [{ role: "owner" }] as T[] };
      throw new Error("brain_source_unavailable");
    } };
    await expect(getBusinessBrain(db, "user_fixture", "tenant_fixture")).rejects.toThrow("brain_source_unavailable");
    expect(calls).toHaveLength(2);
    expect(calls[1].sql).toContain("from business_brain_entries");
  });

  it("does not start any brain read for a non-member", async () => {
    const { db, calls } = singleFlight(() => []);
    await expect(getBusinessBrain(db, "other_user", "tenant_fixture")).rejects.toMatchObject({ code: "tenant_access_denied" });
    expect(calls).toHaveLength(1);
  });

  it("loads marketplace sources serially and retains the source ordering and tenant filters", async () => {
    const { db, calls } = singleFlight(({ sql }) => [{ source_kind: sql.includes("from connector_installation_plans") ? "connector_plan" : sql.includes("from workflows") ? "workflow" : "ai_employee_profile" }]);
    const sources = await listMarketplaceSourceRows(db, "tenant_fixture");
    expect(sources.map(source => source.source_kind)).toEqual(["connector_plan", "workflow", "ai_employee_profile"]);
    expect(calls.map(call => call.params)).toEqual(Array(3).fill(["tenant_fixture"]));
    expect(calls[0].sql).toContain("plan.enabled = 0");
    expect(calls[0].sql).toContain("plan.installation_mode = 'sandbox_only'");
    expect(calls[1].sql).toContain("status = 'active'");
    expect(calls[2].sql).toContain("record_status = 'current'");
  });

  it("does not start employee source reads after marketplace workflow failure", async () => {
    const calls: Call[] = [];
    const db: DbClient = { async query<T>(sql: string, params?: unknown[]) {
      calls.push({ sql, params });
      if (sql.includes("from workflows")) throw new Error("workflow_source_unavailable");
      return { rows: [] as T[] };
    } };
    await expect(listMarketplaceSourceRows(db, "tenant_fixture")).rejects.toThrow("workflow_source_unavailable");
    expect(calls).toHaveLength(2);
    expect(calls.some(call => call.sql.includes("from ai_employee_profiles"))).toBe(false);
  });

  it("generates and refreshes through one guarded transaction client, with audit, replay and permissions intact", async () => {
    const db = await createMemoryDb();
    try {
      const setup = createServices(db);
      const owner = await setup.registerUser({ name: "Fixture séquence", email: "query-sequence@example.test", password: "FixturePassword!1" });
      const outsider = await setup.registerUser({ name: "Fixture tierce", email: "query-sequence-other@example.test", password: "FixturePassword!1" });
      const tenant = await setup.createTenant(owner.id, { name: "Entreprise séquence", category: "Services" });
      await setup.saveOnboarding(owner.id, tenant.id, defaultGarageOnboarding());
      const effects = () => db.query(`select
        (select count(*)::int from contacts where tenant_id=$1) as contacts,
        (select count(*)::int from tasks where tenant_id=$1) as tasks,
        (select count(*)::int from workflow_runs where tenant_id=$1) as workflows`, [tenant.id]);
      const before = (await effects()).rows;
      const contexts: SqlTransactionContext[] = [];
      const runtime = {
        __runtime: "postgres", query: (sql: string, params?: unknown[]) => db.query(sql, params),
        __withTransaction: (context: SqlTransactionContext, callback: (tx: DbClient) => Promise<unknown>) => db.transaction(async tx => {
          contexts.push(context);
          let active = false;
          const transaction = { __runtime: "postgres", __transaction: true,
            async query<T>(sql: string, params?: unknown[]) {
              if (active) throw new Error("single_connection_query_overlap");
              active = true;
              try { await Promise.resolve(); return await tx.query<T>(sql, params); }
              finally { active = false; }
            },
          } as DbClient;
          return callback(transaction);
        }),
      } as unknown as DbClient;
      const services = createServices(runtime);
      const generation = await services.generateStrategicRecommendations(owner.id, tenant.id);
      expect(generation.createdIds.length).toBeGreaterThan(0);
      expect((await services.generateStrategicRecommendations(owner.id, tenant.id)).createdIds).toEqual([]);
      const refreshed = await services.refreshPrivateAppMarketplace(owner.id, tenant.id);
      expect(refreshed.createdCount).toBeGreaterThan(0);
      expect(await services.refreshPrivateAppMarketplace(owner.id, tenant.id)).toMatchObject({ createdCount: 0, unchangedCount: refreshed.createdCount });
      await expect(services.generateStrategicRecommendations(outsider.id, tenant.id)).rejects.toMatchObject({ code: "tenant_access_denied" });
      await expect(services.refreshPrivateAppMarketplace(outsider.id, tenant.id)).rejects.toMatchObject({ code: "tenant_access_denied" });
      expect(contexts).toHaveLength(6);
      expect(contexts.map(context => context.actorId)).toEqual([
        owner.id, owner.id, owner.id, owner.id, outsider.id, outsider.id,
      ]);
      expect(contexts.every(context => context.tenantId === tenant.id && !context.systemAccess)).toBe(true);
      expect((await effects()).rows).toEqual(before);
      const audit = await db.query<{ action: string; count: number }>(`select action,count(*)::int as count from audit_logs
        where tenant_id=$1 and action in ('strategic_advisor.recommendations_generated','app_marketplace.private_catalog_refreshed') group by action order by action`, [tenant.id]);
      expect(audit.rows).toEqual([
        { action: "app_marketplace.private_catalog_refreshed", count: 2 },
        { action: "strategic_advisor.recommendations_generated", count: 2 },
      ]);
    } finally { await db.close(); }
  });
});
