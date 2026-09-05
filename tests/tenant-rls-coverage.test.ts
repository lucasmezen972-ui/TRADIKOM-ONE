import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import {
  hasCompleteTenantRlsPolicyCoverage,
  tenantRlsCoverageGapsSql,
} from "../scripts/tenant-rls-coverage";

describe("couverture des politiques RLS tenant", () => {
  it("accepte une politique ALL", () => {
    expect(
      hasCompleteTenantRlsPolicyCoverage({
        rlsEnabled: true,
        policyCommands: ["ALL"],
      }),
    ).toBe(true);
  });

  it("accepte les quatre politiques séparées", () => {
    expect(
      hasCompleteTenantRlsPolicyCoverage({
        rlsEnabled: true,
        policyCommands: ["SELECT", "INSERT", "UPDATE", "DELETE"],
      }),
    ).toBe(true);
  });

  it("refuse une opération manquante", () => {
    expect(
      hasCompleteTenantRlsPolicyCoverage({
        rlsEnabled: true,
        policyCommands: ["SELECT", "INSERT", "UPDATE"],
      }),
    ).toBe(false);
  });

  it("refuse une table sans RLS même avec toutes les politiques", () => {
    expect(
      hasCompleteTenantRlsPolicyCoverage({
        rlsEnabled: false,
        policyCommands: ["ALL", "SELECT", "INSERT", "UPDATE", "DELETE"],
      }),
    ).toBe(false);
  });

  it("partage la requête stricte avec le vérificateur PostgreSQL", () => {
    expect(tenantRlsCoverageGapsSql).toContain("policies.cmd = 'ALL'");
    expect(tenantRlsCoverageGapsSql).toContain(
      "policies.cmd in ('SELECT', 'INSERT', 'UPDATE', 'DELETE')",
    );
    expect(tenantRlsCoverageGapsSql).toContain(") < 4");
  });

  it("détecte réellement les tables sans RLS ou sans opération complète", async () => {
    const db = new PGlite();
    try {
      await db.exec(`
        create table covered_by_all (tenant_id text not null);
        alter table covered_by_all enable row level security;
        create policy covered_by_all_policy on covered_by_all
          for all using (true) with check (true);

        create table covered_by_operations (tenant_id text not null);
        alter table covered_by_operations enable row level security;
        create policy covered_select on covered_by_operations
          for select using (true);
        create policy covered_insert on covered_by_operations
          for insert with check (true);
        create policy covered_update on covered_by_operations
          for update using (true) with check (true);
        create policy covered_delete on covered_by_operations
          for delete using (true);

        create table missing_delete (tenant_id text not null);
        alter table missing_delete enable row level security;
        create policy missing_select on missing_delete
          for select using (true);
        create policy missing_insert on missing_delete
          for insert with check (true);
        create policy missing_update on missing_delete
          for update using (true) with check (true);

        create table rls_disabled (tenant_id text not null);
        create policy disabled_all on rls_disabled
          for all using (true) with check (true);
      `);

      const gaps = await db.query<{ table_name: string }>(
        tenantRlsCoverageGapsSql,
      );
      expect(gaps.rows).toEqual([
        { table_name: "missing_delete" },
        { table_name: "rls_disabled" },
      ]);
    } finally {
      await db.close();
    }
  });
});
