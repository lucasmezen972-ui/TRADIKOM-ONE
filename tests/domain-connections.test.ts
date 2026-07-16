import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { safeJson } from "../src/lib/security";
import { createServices } from "../src/lib/services";
import { normalizeDomain } from "../src/modules/domain-connections";

const opened: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("connexions de domaine", () => {
  it("rejette les cibles privées, locales et les URL avec identité intégrée", () => {
    for (const unsafe of [
      "localhost",
      "http://127.0.0.1/admin",
      "http://169.254.169.254/latest/meta-data",
      "http://[::1]/admin",
      "https://utilisateur@public.example.test",
    ]) {
      expect(() => normalizeDomain(unsafe)).toThrow(
        "Le nom de domaine n'est pas valide.",
      );
    }
  });

  it("analyse, fait approuver et simule un plan mock sans effet DNS externe", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const owner = await services.registerUser({
      name: "Responsable Domaine",
      email: "domain-owner@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: "Atelier Domaine",
      category: "Garage automobile",
    });

    const analysis = await services.analyzeDomainConnection(owner.id, tenant.id, {
      domain: "https://atelier.example.test/accueil",
      providerKey: "mock_dns",
    });
    expect(analysis).toMatchObject({
      domain: "atelier.example.test",
      state: "analyzed",
      provider: "Fournisseur DNS de test",
      capabilities: { sandbox: true, deleteRecord: false },
    });
    expect(analysis.records.map((record) => record.type)).toEqual(
      expect.arrayContaining(["A", "AAAA", "CNAME", "MX", "TXT", "NS"]),
    );
    expect(analysis.evidence.every((item) => item.status === "verified")).toBe(true);

    const plan = await services.prepareDnsChangePlan(owner.id, tenant.id, {
      connectionId: analysis.connectionId,
    });
    expect(plan).toMatchObject({
      status: "awaiting_approval",
      changes: [
        {
          action: "create",
          record: { type: "CNAME", name: "www" },
        },
      ],
    });
    expect(plan.manualGuide[0]).toMatchObject({
      step: 1,
      ttl: 300,
      name: "www",
    });

    await expect(
      services.simulateDnsChangePlan(owner.id, tenant.id, plan.planId),
    ).rejects.toMatchObject({ code: "dns_plan_invalid_state" });
    expect(
      await services.approveDnsChangePlan(owner.id, tenant.id, plan.planId),
    ).toEqual({
      planId: plan.planId,
      status: "awaiting_second_confirmation",
    });
    expect(
      await services.confirmDnsChangePlan(owner.id, tenant.id, plan.planId),
    ).toEqual({
      planId: plan.planId,
      status: "approved_for_simulation",
    });
    expect(
      await services.simulateDnsChangePlan(owner.id, tenant.id, plan.planId),
    ).toMatchObject({
      status: "simulated",
      environment: "mock",
      externalChangeApplied: false,
    });

    const snapshots = await db.query<{ records: string }>(
      `select records from dns_snapshots
       where tenant_id = $1 and domain_connection_id = $2`,
      [tenant.id, analysis.connectionId],
    );
    expect(snapshots.rows).toHaveLength(1);
    expect(safeJson<Array<{ value: string }>>(snapshots.rows[0]?.records, [])).not.toContainEqual(
      expect.objectContaining({ value: "sites.mock.tradikom.invalid" }),
    );
    expect(
      (
        await db.query(
          "select id from dns_change_approvals where tenant_id = $1 and dns_change_plan_id = $2",
          [tenant.id, plan.planId],
        )
      ).rows,
    ).toHaveLength(2);
    const audit = await db.query<{ safe_metadata: string }>(
      `select safe_metadata from audit_logs
       where tenant_id = $1 and action = 'domain_connection.dns_plan_simulated'
       order by created_at desc limit 1`,
      [tenant.id],
    );
    expect(safeJson(audit.rows[0]?.safe_metadata, {})).toMatchObject({
      providerSandbox: true,
      externalChangeApplied: false,
    });
  });

  it("bloque les suppressions, les changements MX et les remplacements SPF", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const owner = await services.registerUser({
      name: "Sécurité Domaine",
      email: "domain-security@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: "Sécurité DNS",
      category: "Conseil",
    });
    const analysis = await services.analyzeDomainConnection(owner.id, tenant.id, {
      domain: "security.example.test",
      providerKey: "mock_dns",
    });

    await expect(
      services.prepareDnsChangePlan(owner.id, tenant.id, {
        connectionId: analysis.connectionId,
        changes: [
          {
            action: "delete",
            record: {
              type: "A",
              name: "@",
              value: "203.0.113.10",
              ttl: 300,
              priority: null,
            },
            previousRecord: null,
            reason: "Tentative destructive de test",
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "dns_change_blocked" });
    await expect(
      services.prepareDnsChangePlan(owner.id, tenant.id, {
        connectionId: analysis.connectionId,
        changes: [
          {
            action: "update",
            record: {
              type: "MX",
              name: "@",
              value: "new-mail.example.test",
              ttl: 3600,
              priority: 10,
            },
            previousRecord: null,
            reason: "Tentative MX de test",
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "dns_change_blocked" });
    await expect(
      services.prepareDnsChangePlan(owner.id, tenant.id, {
        connectionId: analysis.connectionId,
        changes: [
          {
            action: "update",
            record: {
              type: "TXT",
              name: "@",
              value: "v=spf1 -all",
              ttl: 3600,
              priority: null,
            },
            previousRecord: null,
            reason: "Tentative SPF de test",
          },
        ],
      }),
    ).rejects.toMatchObject({ code: "dns_change_blocked" });
  });

  it("isole les domaines et les relations entre organisations", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const ownerA = await services.registerUser({
      name: "Domaine A",
      email: "domain-a@example.com",
      password: "Password!1",
    });
    const ownerB = await services.registerUser({
      name: "Domaine B",
      email: "domain-b@example.com",
      password: "Password!1",
    });
    const tenantA = await services.createTenant(ownerA.id, {
      name: "Entreprise A",
      category: "Commerce",
    });
    const tenantB = await services.createTenant(ownerB.id, {
      name: "Entreprise B",
      category: "Services",
    });
    const analysis = await services.analyzeDomainConnection(ownerA.id, tenantA.id, {
      domain: "tenant-a.example.test",
      providerKey: "manual",
    });
    expect(analysis).toMatchObject({ state: "manual_setup_required", records: [] });
    await expect(
      services.getDomainConnectionWorkspace(ownerB.id, tenantA.id),
    ).rejects.toThrow("Acces refuse");
    expect(
      await services.getDomainConnectionWorkspace(ownerB.id, tenantB.id),
    ).toMatchObject({ connections: [], plans: [] });
    await expect(
      db.query(
        `insert into dns_snapshots (
           id, tenant_id, domain_connection_id, records, evidence, captured_at
         ) values ('cross_tenant_snapshot', $1, $2, '[]', '[]', $3)`,
        [tenantB.id, analysis.connectionId, new Date().toISOString()],
      ),
    ).rejects.toThrow();
  });
});
