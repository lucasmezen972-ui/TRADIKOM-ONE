import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import {
  hasCompleteTenantRlsPolicyCoverage,
  tenantRlsCoverageGapsSql,
} from "../scripts/tenant-rls-coverage";

describe("couverture des politiques RLS tenant", () => {
  it("accepte une politique ALL réellement bornée au tenant", () => {
    expect(
      hasCompleteTenantRlsPolicyCoverage({
        rlsEnabled: true,
        policies: [tenantPolicy("ALL")],
      }),
    ).toBe(true);
  });

  it("accepte les quatre politiques séparées", () => {
    expect(
      hasCompleteTenantRlsPolicyCoverage({
        rlsEnabled: true,
        policies: ["SELECT", "INSERT", "UPDATE", "DELETE"].map((command) =>
          tenantPolicy(command),
        ),
      }),
    ).toBe(true);
  });

  it("refuse une opération manquante", () => {
    expect(
      hasCompleteTenantRlsPolicyCoverage({
        rlsEnabled: true,
        policies: ["SELECT", "INSERT", "UPDATE"].map((command) =>
          tenantPolicy(command),
        ),
      }),
    ).toBe(false);
  });

  it("refuse une table sans RLS même avec toutes les politiques", () => {
    expect(
      hasCompleteTenantRlsPolicyCoverage({
        rlsEnabled: false,
        policies: [tenantPolicy("ALL")],
      }),
    ).toBe(false);
  });

  it("refuse une politique ALL publique qui autorise tout", () => {
    expect(
      hasCompleteTenantRlsPolicyCoverage({
        rlsEnabled: true,
        policies: [{
          command: "ALL",
          roles: ["public"],
          usingExpression: "true",
          withCheckExpression: "true",
        }],
      }),
    ).toBe(false);
  });

  it("refuse une politique permissive ouverte ajoutée à une bonne politique", () => {
    expect(
      hasCompleteTenantRlsPolicyCoverage({
        rlsEnabled: true,
        policies: [
          tenantPolicy("ALL"),
          {
            command: "ALL",
            roles: ["public"],
            usingExpression: "true",
            withCheckExpression: "true",
          },
        ],
      }),
    ).toBe(false);
  });

  it("refuse aussi une politique permissive ouverte visant un rôle précis", () => {
    expect(
      hasCompleteTenantRlsPolicyCoverage({
        rlsEnabled: true,
        policies: [
          tenantPolicy("ALL"),
          {
            command: "ALL",
            roles: ["app_runtime"],
            usingExpression: "true",
            withCheckExpression: "true",
          },
        ],
      }),
    ).toBe(false);
  });

  it("refuse une branche OR non bornée ajoutée à un prédicat tenant", () => {
    const unsafeExpression =
      "app_is_system() or tenant_id = app_current_tenant_id() or tenant_id is not null";
    expect(
      hasCompleteTenantRlsPolicyCoverage({
        rlsEnabled: true,
        policies: [
          {
            command: "ALL",
            roles: ["public"],
            usingExpression: unsafeExpression,
            withCheckExpression: unsafeExpression,
          },
        ],
      }),
    ).toBe(false);
  });

  it("accepte seulement les helpers d'accès dérivé explicitement approuvés", () => {
    const approvedExpression =
      "app_is_system() or app_actor_can_access_conversation_thread(tenant_id, thread_id)";
    expect(
      hasCompleteTenantRlsPolicyCoverage({
        rlsEnabled: true,
        policies: [policyWithExpression("ALL", approvedExpression)],
      }),
    ).toBe(true);

    const unapprovedExpression =
      "app_is_system() or app_actor_can_access_everything(tenant_id)";
    expect(
      hasCompleteTenantRlsPolicyCoverage({
        rlsEnabled: true,
        policies: [
          tenantPolicy("ALL"),
          {
            ...policyWithExpression("ALL", unapprovedExpression),
            roles: ["app_runtime"],
          },
        ],
      }),
    ).toBe(false);
  });

  it("partage la requête stricte avec le vérificateur PostgreSQL", () => {
    expect(tenantRlsCoverageGapsSql).toContain(
      "policies.cmd in ('ALL', required_operations.operation)",
    );
    expect(tenantRlsCoverageGapsSql).toContain(
      "'public' = any(policies.roles)",
    );
    expect(tenantRlsCoverageGapsSql).toContain(
      "app_current_tenant_id\\(\\)",
    );
    expect(tenantRlsCoverageGapsSql).toContain("policies.with_check is not null");
    expect(tenantRlsCoverageGapsSql).toContain(
      "policies.permissive = 'PERMISSIVE'",
    );
  });

  it("détecte réellement les tables sans RLS ou sans opération complète", async () => {
    const db = new PGlite();
    try {
      await db.exec(`
        create function app_is_system() returns boolean
          language sql stable as $$ select false $$;
        create function app_current_tenant_id() returns text
          language sql stable as $$ select null::text $$;
        create function app_actor_can_access_conversation_thread(text, text)
          returns boolean language sql stable as $$ select false $$;
        create function app_actor_can_access_everything(text)
          returns boolean language sql stable as $$ select true $$;
        create role app_runtime;

        create table covered_by_all (tenant_id text not null);
        alter table covered_by_all enable row level security;
        create policy covered_by_all_policy on covered_by_all
          for all
          using (app_is_system() or tenant_id = app_current_tenant_id())
          with check (app_is_system() or tenant_id = app_current_tenant_id());

        create table covered_by_operations (tenant_id text not null);
        alter table covered_by_operations enable row level security;
        create policy covered_select on covered_by_operations
          for select using (app_is_system() or tenant_id = app_current_tenant_id());
        create policy covered_insert on covered_by_operations
          for insert with check (app_is_system() or tenant_id = app_current_tenant_id());
        create policy covered_update on covered_by_operations
          for update
          using (app_is_system() or tenant_id = app_current_tenant_id())
          with check (app_is_system() or tenant_id = app_current_tenant_id());
        create policy covered_delete on covered_by_operations
          for delete using (app_is_system() or tenant_id = app_current_tenant_id());

        create table covered_by_approved_helper (
          tenant_id text not null,
          thread_id text not null
        );
        alter table covered_by_approved_helper enable row level security;
        create policy covered_by_approved_helper_policy on covered_by_approved_helper
          for all
          using (
            app_is_system()
            or app_actor_can_access_conversation_thread(tenant_id, thread_id)
          )
          with check (
            app_is_system()
            or app_actor_can_access_conversation_thread(tenant_id, thread_id)
          );

        create table unsafe_all (tenant_id text not null);
        alter table unsafe_all enable row level security;
        create policy unsafe_all_policy on unsafe_all
          for all using (true) with check (true);

        create table safe_plus_unsafe (tenant_id text not null);
        alter table safe_plus_unsafe enable row level security;
        create policy safe_plus_unsafe_tenant on safe_plus_unsafe
          for all
          using (app_is_system() or tenant_id = app_current_tenant_id())
          with check (app_is_system() or tenant_id = app_current_tenant_id());
        create policy safe_plus_unsafe_open on safe_plus_unsafe
          for all using (true) with check (true);

        create table safe_plus_role_unsafe (tenant_id text not null);
        alter table safe_plus_role_unsafe enable row level security;
        create policy safe_plus_role_unsafe_tenant on safe_plus_role_unsafe
          for all to public
          using (app_is_system() or tenant_id = app_current_tenant_id())
          with check (app_is_system() or tenant_id = app_current_tenant_id());
        create policy safe_plus_role_unsafe_open on safe_plus_role_unsafe
          for all to app_runtime using (true) with check (true);

        create table safe_plus_unapproved_helper (tenant_id text not null);
        alter table safe_plus_unapproved_helper enable row level security;
        create policy safe_plus_unapproved_helper_tenant on safe_plus_unapproved_helper
          for all to public
          using (app_is_system() or tenant_id = app_current_tenant_id())
          with check (app_is_system() or tenant_id = app_current_tenant_id());
        create policy safe_plus_unapproved_helper_open on safe_plus_unapproved_helper
          for all to app_runtime
          using (app_is_system() or app_actor_can_access_everything(tenant_id))
          with check (app_is_system() or app_actor_can_access_everything(tenant_id));

        create table unsafe_extra_branch (tenant_id text not null);
        alter table unsafe_extra_branch enable row level security;
        create policy unsafe_extra_branch_policy on unsafe_extra_branch
          for all
          using (
            app_is_system()
            or tenant_id = app_current_tenant_id()
            or tenant_id is not null
          )
          with check (
            app_is_system()
            or tenant_id = app_current_tenant_id()
            or tenant_id is not null
          );

        create table missing_delete (tenant_id text not null);
        alter table missing_delete enable row level security;
        create policy missing_select on missing_delete
          for select using (app_is_system() or tenant_id = app_current_tenant_id());
        create policy missing_insert on missing_delete
          for insert with check (app_is_system() or tenant_id = app_current_tenant_id());
        create policy missing_update on missing_delete
          for update
          using (app_is_system() or tenant_id = app_current_tenant_id())
          with check (app_is_system() or tenant_id = app_current_tenant_id());

        create table rls_disabled (tenant_id text not null);
        create policy disabled_all on rls_disabled
          for all
          using (app_is_system() or tenant_id = app_current_tenant_id())
          with check (app_is_system() or tenant_id = app_current_tenant_id());
      `);

      const gaps = await db.query<{ table_name: string }>(
        tenantRlsCoverageGapsSql,
      );
      expect(gaps.rows).toEqual([
        { table_name: "missing_delete" },
        { table_name: "rls_disabled" },
        { table_name: "safe_plus_role_unsafe" },
        { table_name: "safe_plus_unapproved_helper" },
        { table_name: "safe_plus_unsafe" },
        { table_name: "unsafe_all" },
        { table_name: "unsafe_extra_branch" },
      ]);
    } finally {
      await db.close();
    }
  });
});

function tenantPolicy(command: string) {
  const expression = "app_is_system() or tenant_id = app_current_tenant_id()";
  return policyWithExpression(command, expression);
}

function policyWithExpression(command: string, expression: string) {
  return {
    command,
    roles: ["public"],
    usingExpression: command === "INSERT" ? null : expression,
    withCheckExpression:
      command === "SELECT" || command === "DELETE" ? null : expression,
  };
}
