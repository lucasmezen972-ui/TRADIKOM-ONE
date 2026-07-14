import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb, type DbClient } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import { setPlatformRole } from "../src/modules/platform-admin";
import { PlatformAdminError } from "../src/modules/platform-admin/errors";

const databases: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("Phase 3 API Intelligence vertical slice", () => {
  it("moves approved evidence to a disabled sandbox connector and private store", async () => {
    const db = await createMemoryDb();
    databases.push(db);
    const openApi = await fixture("mock-garage-openapi.json");
    const breakingOpenApi = await fixture("mock-garage-openapi-breaking.json");
    let sourceRequests = 0;
    let serveBreakingVersion = false;
    const services = createServices(db, {
      discoveryTransport: async (url, input) => {
        if (url.pathname === "/robots.txt") {
          return {
            status: 200,
            headers: { "content-type": "text/plain" },
            body: "User-agent: TradikomApiScout\nAllow: /",
          };
        }
        sourceRequests += 1;
        if (serveBreakingVersion) {
          return {
            status: 200,
            headers: {
              "content-type": "application/json",
              etag: '"fixture-v2"',
              "last-modified": "Mon, 13 Jul 2026 00:00:00 GMT",
            },
            body: breakingOpenApi,
          };
        }
        if (sourceRequests > 1) {
          expect(input.headers).toMatchObject({
            "if-none-match": '"fixture-v1"',
            "if-modified-since": "Sun, 12 Jul 2026 00:00:00 GMT",
          });
          return {
            status: 304,
            headers: { etag: '"fixture-v1"' },
            body: "",
          };
        }
        return {
          status: 200,
          headers: {
            "content-type": "application/json",
            etag: '"fixture-v1"',
            "last-modified": "Sun, 12 Jul 2026 00:00:00 GMT",
          },
          body: openApi,
        };
      },
      mockContractExecutor: async () => ({
        status: 200,
        body: { fixture: true },
      }),
    });
    const admin = await services.registerUser({
      name: "Admin plateforme",
      email: "platform-admin@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(admin.id, {
      name: "Garage API Intelligence",
      category: "Garage automobile",
    });
    await setPlatformRole(db, admin.id, "platform_admin");

    const software = await services.createSoftwareDirectoryEntry(
      admin.id,
      tenant.id,
      {
        canonicalName: "Garage Cloud",
        aliases: ["GC"],
        vendor: "Garage Cloud SAS",
        officialDomain: "docs.garage-cloud.test",
        supportedRegions: ["Europe"],
        languages: ["fr"],
        industries: ["Automobile"],
        categories: ["Gestion de garage"],
        officialWebsite: "https://docs.garage-cloud.test/",
        developerPortal: "https://docs.garage-cloud.test/developers",
      },
    );
    expect(software.approvalStatus).toBe("pending");

    const approvedDomain = await services.decideSoftwareDomain(
      admin.id,
      tenant.id,
      {
        domainId: software.domainId,
        status: "approved",
        reason: "Domaine editeur verifie manuellement.",
      },
    );
    expect(approvedDomain.approval_status).toBe("approved");

    const api = await services.createApiProductRecord(admin.id, tenant.id, {
      softwareId: software.softwareId,
      name: "Garage Cloud API",
      apiStyle: "rest",
      version: "2026-01",
      documentationUrl: "https://docs.garage-cloud.test/openapi.json",
    });
    const source = await services.addOfficialApiSource(admin.id, tenant.id, {
      softwareId: software.softwareId,
      apiProductId: api.apiProductId,
      url: "https://docs.garage-cloud.test/openapi.json",
      sourceType: "official_openapi_specification",
    });
    const snapshot = await services.fetchApprovedApiSource(
      admin.id,
      tenant.id,
      source.sourceId,
    );
    expect(snapshot.robots_decision).toBe("allowed");
    expect(snapshot.content).not.toContain("must-not-survive");
    const unchangedSnapshot = await services.fetchApprovedApiSource(
      admin.id,
      tenant.id,
      source.sourceId,
    );
    expect(unchangedSnapshot.id).toBe(snapshot.id);
    const snapshotCount = await db.query<{ count: number }>(
      "select count(*)::int as count from api_source_snapshots where source_id = $1",
      [source.sourceId],
    );
    expect(snapshotCount.rows[0]?.count).toBe(1);

    const preview = await services.previewOpenApiSnapshot(
      admin.id,
      tenant.id,
      { snapshotId: snapshot.id, apiProductId: api.apiProductId },
    );
    expect(preview.operations.map((item) => item.operationKey)).toEqual([
      "listCustomers",
      "createCustomer",
    ]);
    expect(preview.schemas.map((schema) => schema.name)).toEqual(["Customer"]);
    const imported = await services.persistOpenApiPreview(
      admin.id,
      tenant.id,
      preview,
    );
    expect(imported).toMatchObject({ operationCount: 2, schemaCount: 1 });
    expect(imported.claimIds).toHaveLength(4);
    for (const claimId of imported.claimIds) {
      await services.decideApiClaim(admin.id, tenant.id, {
        claimId,
        status: "approved",
        reason: "Preuve officielle verifiee dans la fixture.",
      });
    }
    const customerEvidence = imported.schemaEvidence.Customer;
    expect(customerEvidence).toBeTruthy();
    if (!customerEvidence) throw new Error("Preuve Customer absente.");

    const mapping = await services.proposeTenantOntologyMapping(
      admin.id,
      tenant.id,
      {
        apiProductId: api.apiProductId,
        sourceEntity: "Customer",
        canonicalEntity: "Contact",
        confidence: 92,
        evidenceId: customerEvidence,
      },
    );
    expect(mapping.status).toBe("pending");
    await services.decideTenantOntologyMapping(admin.id, tenant.id, {
      mappingId: mapping.mappingId,
      status: "approved",
    });

    const compatibility = await services.runCompatibilityCheck(
      admin.id,
      tenant.id,
      {
        softwareId: software.softwareId,
        apiProductId: api.apiProductId,
        tenantIndustry: "Garage automobile",
        desiredAutomation: "Synchroniser les clients vers les contacts.",
      },
    );
    expect(compatibility.outcome).toBe("custom_connector_possible");
    expect(compatibility.evidence).toHaveLength(4);
    expect(
      compatibility.evidence.map((item) => item.locator).sort(),
    ).toEqual([
      "#",
      "#/components/schemas/Customer",
      "#/paths/~1customers/get",
      "#/paths/~1customers/post",
    ]);

    const proposal = await services.generateConnectorProposal(
      admin.id,
      tenant.id,
      {
        compatibilityCheckId: compatibility.checkId,
        name: "Garage Cloud Contacts",
      },
    );
    expect(proposal.status).toBe("static_checks_passed");
    expect(proposal.manifest.enabled).toBe(false);
    const contract = await services.runMockContractTests(
      admin.id,
      tenant.id,
      proposal.proposalId,
    );
    expect(contract.status).toBe("passed");
    const approval = await services.submitConnectorForSandboxApproval(
      admin.id,
      tenant.id,
      proposal.proposalId,
    );
    const decision = await services.decideConnectorSandboxApproval(
      admin.id,
      tenant.id,
      {
        approvalId: approval.approvalId,
        decision: "approved",
        reason: "Fixtures et controles de securite valides.",
      },
    );
    expect(decision).toMatchObject({
      status: "approved",
      connectorEnabled: false,
    });
    const store = await services.getPrivateConnectStore(admin.id, tenant.id);
    expect(store).toHaveLength(1);
    expect(store[0]).toMatchObject({
      connectorName: "Garage Cloud Contacts",
      verificationStatus: "approved_for_sandbox",
      installationStatus: "not_installed",
    });
    expect(store[0]?.manifest?.enabled).toBe(false);

    const otherTenant = await services.createTenant(admin.id, {
      name: "Autre organisation",
      category: "Services",
    });
    expect(
      await services.getPrivateConnectStore(admin.id, otherTenant.id),
    ).toEqual([]);

    const proposalRow = await db.query<{ enabled: number; status: string }>(
      "select enabled, status from connector_proposals where id = $1 and tenant_id = $2",
      [proposal.proposalId, tenant.id],
    );
    expect(proposalRow.rows).toEqual([
      { enabled: 0, status: "approved_for_sandbox" },
    ]);

    serveBreakingVersion = true;
    const changedSnapshot = await services.fetchApprovedApiSource(
      admin.id,
      tenant.id,
      source.sourceId,
    );
    expect(changedSnapshot.id).not.toBe(snapshot.id);
    const changeEvents = await db.query<{
      id: string;
      primary_classification: string;
      requires_approval: number;
    }>("select id, primary_classification, requires_approval from api_change_events");
    expect(changeEvents.rows).toHaveLength(1);
    expect(changeEvents.rows[0]).toMatchObject({
      primary_classification: "breaking",
      requires_approval: 1,
    });
    const impacts = await db.query<{
      id: string;
      tenant_id: string;
      status: string;
      upgrade_blocked: number;
      contract_test_status: string;
      approval_status: string;
    }>("select * from api_change_impacts where tenant_id = $1", [tenant.id]);
    expect(impacts.rows).toHaveLength(1);
    expect(impacts.rows[0]).toMatchObject({
      tenant_id: tenant.id,
      status: "review_required",
      upgrade_blocked: 1,
      contract_test_status: "failed",
      approval_status: "pending",
    });
    const blockedProposal = await db.query<{ enabled: number; status: string }>(
      "select enabled, status from connector_proposals where id = $1 and tenant_id = $2",
      [proposal.proposalId, tenant.id],
    );
    expect(blockedProposal.rows).toEqual([
      { enabled: 0, status: "change_review_required" },
    ]);
    const alerts = await db.query<{ rule_key: string; status: string }>(
      "select rule_key, status from opportunity_radar_alerts where tenant_id = $1",
      [tenant.id],
    );
    expect(alerts.rows).toContainEqual({
      rule_key: "api_breaking_change",
      status: "active",
    });
    const otherWorkspace = await services.getApiIntelligenceWorkspace(
      admin.id,
      otherTenant.id,
    );
    expect(otherWorkspace.changeImpacts).toEqual([]);
    const impactId = impacts.rows[0]?.id;
    if (!impactId) throw new Error("Impact de changement absent.");
    const repairDecision = await services.decideApiChangeRepair(
      admin.id,
      tenant.id,
      {
        impactId,
        decision: "approved",
        reason: "Plan examine; regeneration sandbox encore requise.",
      },
    );
    expect(repairDecision).toEqual({
      impactId,
      decision: "approved",
      upgradeBlocked: true,
      connectorEnabled: false,
    });
    const decidedImpact = await db.query<{
      status: string;
      upgrade_blocked: number;
      approval_status: string;
    }>(
      "select status, upgrade_blocked, approval_status from api_change_impacts where tenant_id = $1 and id = $2",
      [tenant.id, impactId],
    );
    expect(decidedImpact.rows).toEqual([
      {
        status: "repair_approved",
        upgrade_blocked: 1,
        approval_status: "approved",
      },
    ]);
    await expect(
      services.generateApprovedConnectorRepair(admin.id, tenant.id, {
        impactId,
      }),
    ).rejects.toMatchObject({ code: "repair_not_ready" });
    await expect(
      services.generateApprovedConnectorRepair(admin.id, otherTenant.id, {
        impactId,
      }),
    ).rejects.toMatchObject({ code: "impact_not_found" });

    const changedPreview = await services.previewOpenApiSnapshot(
      admin.id,
      tenant.id,
      { snapshotId: changedSnapshot.id, apiProductId: api.apiProductId },
    );
    const changedImport = await services.persistOpenApiPreview(
      admin.id,
      tenant.id,
      changedPreview,
    );
    await expect(
      services.generateApprovedConnectorRepair(admin.id, tenant.id, {
        impactId,
      }),
    ).rejects.toMatchObject({ code: "repair_not_ready" });
    const preservedMappingEvidence = await db.query<{
      source_snapshot_id: string;
    }>(
      `select api_evidence.source_snapshot_id
       from api_tenant_mappings
       join api_evidence on api_evidence.id = api_tenant_mappings.evidence_id
       where api_tenant_mappings.tenant_id = $1
         and api_tenant_mappings.id = $2`,
      [tenant.id, mapping.mappingId],
    );
    expect(preservedMappingEvidence.rows).toEqual([
      { source_snapshot_id: snapshot.id },
    ]);
    for (const claimId of changedImport.claimIds) {
      await services.decideApiClaim(admin.id, tenant.id, {
        claimId,
        status: "approved",
        reason: "Nouvelle preuve officielle verifiee avant reparation.",
      });
    }
    const repair = await services.generateApprovedConnectorRepair(
      admin.id,
      tenant.id,
      { impactId },
    );
    expect(repair).toMatchObject({
      replacementVersion: "0.1.1",
      status: "static_checks_passed",
      enabled: false,
    });
    await expect(
      services.generateApprovedConnectorRepair(admin.id, tenant.id, {
        impactId,
      }),
    ).rejects.toMatchObject({ code: "repair_already_generated" });

    const replacement = await db.query<{
      version: string;
      status: string;
      enabled: number;
      manifest: string;
    }>(
      "select version, status, enabled, manifest from connector_proposals where tenant_id = $1 and id = $2",
      [tenant.id, repair.replacementProposalId],
    );
    expect(replacement.rows[0]).toMatchObject({
      version: "0.1.1",
      status: "static_checks_passed",
      enabled: 0,
    });
    expect(JSON.parse(replacement.rows[0]?.manifest ?? "{}").capabilities).toEqual([
      expect.objectContaining({
        operationKey: "createCustomer",
        method: "POST",
        path: "/customers",
      }),
    ]);
    const repairContract = await services.runMockContractTests(
      admin.id,
      tenant.id,
      repair.replacementProposalId,
    );
    expect(repairContract.status).toBe("passed");
    const repairApproval = await services.submitConnectorForSandboxApproval(
      admin.id,
      tenant.id,
      repair.replacementProposalId,
    );
    await services.decideConnectorSandboxApproval(admin.id, tenant.id, {
      approvalId: repairApproval.approvalId,
      decision: "approved",
      reason: "Version reparee testee et approuvee pour le sandbox.",
    });
    const finalProposals = await db.query<{
      id: string;
      status: string;
      enabled: number;
    }>(
      "select id, status, enabled from connector_proposals where tenant_id = $1 order by version asc",
      [tenant.id],
    );
    expect(finalProposals.rows).toEqual([
      { id: proposal.proposalId, status: "change_review_required", enabled: 0 },
      {
        id: repair.replacementProposalId,
        status: "approved_for_sandbox",
        enabled: 0,
      },
    ]);
    await expectAuditActions(db, tenant.id, [
      "api_intelligence.domain_approved",
      "api_intelligence.source_fetched",
      "api_intelligence.openapi_imported",
      "api_intelligence.claim_approved",
      "api_intelligence.mapping_approved",
      "connector_copilot.proposal_generated",
      "connector_copilot.contract_tests_completed",
      "connector_copilot.sandbox_approval_requested",
      "connector_copilot.sandbox_approved",
      "api_intelligence.change_detected",
      "api_intelligence.connector_upgrade_blocked",
      "api_intelligence.repair_approved",
      "api_intelligence.connector_repair_generated",
    ]);
  });

  it("rejects platform mutations for a tenant owner without the global role", async () => {
    const db = await createMemoryDb();
    databases.push(db);
    const services = createServices(db);
    const owner = await services.registerUser({
      name: "Owner standard",
      email: "owner-standard@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: "Tenant standard",
      category: "Services",
    });
    await expect(
      services.createSoftwareDirectoryEntry(owner.id, tenant.id, {
        canonicalName: "Produit non autorise",
        aliases: [],
        vendor: "Editeur",
        officialDomain: "docs.vendor.test",
        supportedRegions: [],
        languages: ["fr"],
        industries: [],
        categories: [],
        officialWebsite: "https://docs.vendor.test/",
      }),
    ).rejects.toBeInstanceOf(PlatformAdminError);
    await expect(
      services.generateApprovedConnectorRepair(owner.id, tenant.id, {
        impactId: "impact_missing",
      }),
    ).rejects.toBeInstanceOf(PlatformAdminError);
  });
});

async function fixture(name: string) {
  return readFile(path.join(process.cwd(), "tests", "fixtures", name), "utf8");
}

async function expectAuditActions(
  db: DbClient,
  tenantId: string,
  expected: string[],
) {
  const result = await db.query<{ action: string }>(
    "select action from audit_logs where tenant_id = $1",
    [tenantId],
  );
  const actions = result.rows.map((row) => row.action);
  expected.forEach((action) => expect(actions).toContain(action));
}
