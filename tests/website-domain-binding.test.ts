import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb } from "../src/lib/db";
import { defaultGarageOnboarding } from "../src/lib/generation";
import { createServices } from "../src/lib/services";
import { processPendingDomainEvents } from "../src/modules/workflows/worker";

const opened: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("liaison contrôlée d'un domaine au site", () => {
  it("vérifie le fournisseur mock sans publier le brouillon et se déconnecte sans toucher au site", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const owner = await services.registerUser({
      name: "Domaine publié",
      email: "domain-binding@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: "Atelier domaine",
      category: "Garage automobile",
    });
    await services.saveOnboarding(
      owner.id,
      tenant.id,
      defaultGarageOnboarding(),
    );
    await services.publishWebsite(owner.id, tenant.id);
    const publicBefore = await services.getPublishedSite(tenant.slug);
    const websiteBefore = await services.getWebsiteWorkspace(owner.id, tenant.id);
    const hero = websiteBefore.sections.find((section) => section.type === "hero");
    expect(publicBefore?.sections[0]?.title).toBe(hero?.title);

    const connection = await services.analyzeDomainConnection(owner.id, tenant.id, {
      domain: "atelier-binding.example.test",
      providerKey: "mock_dns",
    });
    const plan = await services.prepareDnsChangePlan(owner.id, tenant.id, {
      connectionId: connection.connectionId,
    });
    await services.approveDnsChangePlan(owner.id, tenant.id, plan.planId);
    await services.confirmDnsChangePlan(owner.id, tenant.id, plan.planId);
    await services.simulateDnsChangePlan(owner.id, tenant.id, plan.planId);

    const binding = await services.requestWebsiteDomainBinding(
      owner.id,
      tenant.id,
      connection.connectionId,
    );
    expect(binding).toMatchObject({
      status: "pending_verification",
      idempotentReplay: false,
    });
    await expect(
      services.requestWebsiteDomainBinding(
        owner.id,
        tenant.id,
        connection.connectionId,
      ),
    ).resolves.toMatchObject({
      bindingId: binding.bindingId,
      status: "pending_verification",
      idempotentReplay: true,
    });

    await services.updateWebsiteSection(owner.id, tenant.id, hero!.id, {
      title: "Brouillon non publié pendant la liaison",
      body: hero!.body,
      imageUrl: hero!.imageUrl,
      buttonLabel: hero!.buttonLabel,
      buttonHref: hero!.buttonHref,
      enabled: true,
    });
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const summary = await processPendingDomainEvents(db, { limit: 100 });
      if (summary.selected === 0) break;
    }

    const workspace = await services.getDomainConnectionWorkspace(
      owner.id,
      tenant.id,
    );
    expect(workspace.connections[0]).toMatchObject({
      state: "verified",
      certificateStatus: "available",
    });
    expect(workspace.bindings[0]).toMatchObject({
      id: binding.bindingId,
      status: "bound",
      certificateStatus: "available",
      publishedSnapshotLocked: true,
    });
    const verification = await db.query<{ status: string; attempts: number }>(
      `select status, attempts from domain_verification_jobs
        where tenant_id = $1 and website_domain_binding_id = $2`,
      [tenant.id, binding.bindingId],
    );
    expect(verification.rows[0]).toEqual({ status: "verified", attempts: 1 });

    const publicAfter = await services.getPublishedSite(tenant.slug);
    expect(publicAfter?.sections[0]?.title).toBe(publicBefore?.sections[0]?.title);
    expect(publicAfter?.sections[0]?.title).not.toBe(
      "Brouillon non publié pendant la liaison",
    );

    await services.disconnectWebsiteDomainBinding(
      owner.id,
      tenant.id,
      binding.bindingId,
    );
    const disconnected = await services.getDomainConnectionWorkspace(
      owner.id,
      tenant.id,
    );
    expect(disconnected.bindings[0]?.status).toBe("disconnected");
    expect((await services.getPublishedSite(tenant.slug))?.sections[0]?.title).toBe(
      publicBefore?.sections[0]?.title,
    );
  });

  it("refuse une cible mock non conforme et isole la demande entre tenants", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const ownerA = await services.registerUser({
      name: "Domaine A",
      email: "domain-binding-a@example.com",
      password: "Password!1",
    });
    const ownerB = await services.registerUser({
      name: "Domaine B",
      email: "domain-binding-b@example.com",
      password: "Password!1",
    });
    const tenantA = await services.createTenant(ownerA.id, {
      name: "Domaine A",
      category: "Services",
    });
    const tenantB = await services.createTenant(ownerB.id, {
      name: "Domaine B",
      category: "Services",
    });
    await expect(
      services.analyzeDomainConnection(ownerA.id, tenantA.id, {
        domain: "entreprise.fr",
        providerKey: "mock_dns",
      }),
    ).rejects.toMatchObject({ code: "mock_domain_required" });
    await services.saveOnboarding(
      ownerA.id,
      tenantA.id,
      defaultGarageOnboarding(),
    );
    await services.publishWebsite(ownerA.id, tenantA.id);
    const connection = await services.analyzeDomainConnection(ownerA.id, tenantA.id, {
      domain: "takeover.example.test",
      providerKey: "mock_dns",
    });
    const plan = await services.prepareDnsChangePlan(ownerA.id, tenantA.id, {
      connectionId: connection.connectionId,
      changes: [
        {
          action: "create",
          record: {
            type: "CNAME",
            name: "www",
            value: "unapproved-target.invalid",
            ttl: 300,
            priority: null,
          },
          previousRecord: null,
          reason: "Prouver que la cible non approuvée est refusée.",
        },
      ],
    });
    await services.approveDnsChangePlan(ownerA.id, tenantA.id, plan.planId);
    await services.confirmDnsChangePlan(ownerA.id, tenantA.id, plan.planId);
    await services.simulateDnsChangePlan(ownerA.id, tenantA.id, plan.planId);
    await expect(
      services.requestWebsiteDomainBinding(
        ownerB.id,
        tenantB.id,
        connection.connectionId,
      ),
    ).rejects.toMatchObject({ code: "domain_connection_not_found" });

    const binding = await services.requestWebsiteDomainBinding(
      ownerA.id,
      tenantA.id,
      connection.connectionId,
    );
    await processPendingDomainEvents(db, { limit: 100 });
    const workspace = await services.getDomainConnectionWorkspace(
      ownerA.id,
      tenantA.id,
    );
    expect(workspace.bindings[0]).toMatchObject({
      id: binding.bindingId,
      status: "failed",
      safeErrorCode: "mock_dns_target_mismatch",
    });
    expect(workspace.connections[0]?.state).toBe("failed");
  });
});
