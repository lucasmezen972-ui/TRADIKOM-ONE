import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb, type DbClient } from "../src/lib/db";
import { id, nowIso, safeJson, toJson } from "../src/lib/security";
import { createServices } from "../src/lib/services";
import { prepareConnectorInstallationPlan } from "../src/modules/universal-connectors";

const opened: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("Universal Connector Platform", () => {
  it("prepares an evidence-backed disabled sandbox plan without operational effects", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const owner = await services.registerUser({
      name: "Universal Connector Owner",
      email: "universal-connector-owner@example.com",
      password: "Password!1",
    });
    const outsider = await services.registerUser({
      name: "Universal Connector Outsider",
      email: "universal-connector-outsider@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: "Universal Connector Garage",
      category: "Garage automobile",
    });
    const otherTenant = await services.createTenant(outsider.id, {
      name: "Universal Connector Cabinet",
      category: "Conseil juridique",
    });
    const fixture = await seedApprovedConnector(db, owner.id, tenant.id);

    const before = await countOperationalEffects(db, tenant.id);
    let workspace = await services.getUniversalConnectorWorkspace(
      owner.id,
      tenant.id,
    );
    expect(workspace.canManage).toBe(true);
    expect(workspace.candidates).toHaveLength(1);
    expect(workspace.candidates[0]).toMatchObject({
      storeEntryId: fixture.storeEntryId,
      connectorName: "Garage Cloud Contacts",
      industryMatch: "aligned",
      eligible: true,
      enabled: false,
      installationMode: "sandbox_only",
      evidence: {
        productClaimApproved: true,
        approvedOperationCount: 2,
        mappingCount: 1,
        contractStatus: "passed",
        contractEnvironment: "mock",
      },
    });
    expect(workspace.candidates[0]?.capabilities).toEqual([
      {
        key: "listCustomers",
        direction: "read",
        method: "GET",
        approvalRequired: false,
      },
      {
        key: "createCustomer",
        direction: "write",
        method: "POST",
        approvalRequired: true,
      },
    ]);

    const prepared = await services.prepareConnectorInstallationPlan(
      owner.id,
      tenant.id,
      { storeEntryId: fixture.storeEntryId },
    );
    expect(prepared).toMatchObject({ version: 1, created: true, enabled: false });
    expect(
      await services.prepareConnectorInstallationPlan(owner.id, tenant.id, {
        storeEntryId: fixture.storeEntryId,
      }),
    ).toEqual({ ...prepared, created: false });

    workspace = await services.getUniversalConnectorWorkspace(owner.id, tenant.id);
    expect(workspace.plans).toHaveLength(1);
    expect(workspace.plans[0]).toMatchObject({
      id: prepared.planId,
      version: 1,
      status: "current",
      enabled: false,
      installationMode: "sandbox_only",
      blockers: [],
    });
    expect(await countOperationalEffects(db, tenant.id)).toEqual(before);

    const audit = await db.query<{ safe_metadata: string }>(
      `select safe_metadata from audit_logs
       where tenant_id = $1
         and action = 'universal_connector.installation_plan_prepared'
       order by created_at desc limit 1`,
      [tenant.id],
    );
    expect(safeJson(audit.rows[0]?.safe_metadata, {})).toMatchObject({
      connectorEnabled: false,
      credentialsStored: false,
      externalWriteTriggered: false,
      capabilityCount: 2,
      mappingCount: 1,
    });

    await expect(
      services.getUniversalConnectorWorkspace(outsider.id, tenant.id),
    ).rejects.toThrow("Acces refuse");
    await expect(
      services.prepareConnectorInstallationPlan(outsider.id, tenant.id, {
        storeEntryId: fixture.storeEntryId,
      }),
    ).rejects.toThrow("Acces refuse");
    expect(
      await services.getUniversalConnectorWorkspace(outsider.id, otherTenant.id),
    ).toMatchObject({ candidates: [], plans: [] });

    await db.query(
      "update api_claims set approval_status = 'rejected' where id = $1",
      [fixture.writeOperationClaimId],
    );
    workspace = await services.getUniversalConnectorWorkspace(owner.id, tenant.id);
    expect(workspace.candidates[0]).toMatchObject({ eligible: false });
    expect(workspace.candidates[0]?.blockers).toContain(
      "Les capacités ne correspondent plus aux preuves API approuvées.",
    );
    await expect(
      services.prepareConnectorInstallationPlan(owner.id, tenant.id, {
        storeEntryId: fixture.storeEntryId,
      }),
    ).rejects.toMatchObject({ code: "connector_evidence_incomplete" });
  });

  it("rolls back supersession when plan audit persistence fails", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const owner = await services.registerUser({
      name: "Universal Connector Rollback",
      email: "universal-connector-rollback@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: "Universal Connector Rollback Garage",
      category: "Garage automobile",
    });
    const fixture = await seedApprovedConnector(db, owner.id, tenant.id);
    await services.prepareConnectorInstallationPlan(owner.id, tenant.id, {
      storeEntryId: fixture.storeEntryId,
    });
    await db.query(
      `insert into connector_contract_runs (
         id, tenant_id, connector_proposal_id, connector_version, api_version,
         test_suite_version, environment, status, results, safe_logs, created_at
       ) values ($1, $2, $3, '0.1.0', '1', 'contract-1', 'mock', 'passed', $4, $5, $6)`,
      [
        id("contract"),
        tenant.id,
        fixture.proposalId,
        toJson([]),
        toJson(["fixture passed"]),
        nowIso(),
      ],
    );
    const failingDb: DbClient = {
      query: async <T = Record<string, unknown>>(sql: string, params?: unknown[]) => {
        if (sql.includes("insert into audit_logs")) {
          throw new Error("injected connector plan audit failure");
        }
        return db.query<T>(sql, params);
      },
    };
    await expect(
      prepareConnectorInstallationPlan(failingDb, owner.id, tenant.id, {
        storeEntryId: fixture.storeEntryId,
      }),
    ).rejects.toThrow("injected connector plan audit failure");
    const plans = await db.query<{
      record_status: string;
      version: number;
    }>(
      `select record_status, version from connector_installation_plans
       where tenant_id = $1 order by version`,
      [tenant.id],
    );
    expect(plans.rows).toEqual([{ record_status: "current", version: 1 }]);
  });
});

async function seedApprovedConnector(
  db: Awaited<ReturnType<typeof createMemoryDb>>,
  userId: string,
  tenantId: string,
) {
  const now = nowIso();
  const softwareId = id("software");
  const apiProductId = id("api_product");
  const sourceId = id("api_source");
  const snapshotId = id("api_snapshot");
  const productClaimId = id("api_claim");
  const productEvidenceId = id("api_evidence");
  const readOperationId = id("api_operation");
  const writeOperationId = id("api_operation");
  const readOperationClaimId = id("api_claim");
  const writeOperationClaimId = id("api_claim");
  const proposalId = id("proposal");
  const contractRunId = id("contract");
  const storeEntryId = id("store");
  await db.query(
    `insert into software_directory_entries (
       id, canonical_name, aliases, vendor, official_domain, country,
       supported_regions, languages, industries, categories, official_website,
       developer_portal, support_page, partner_program_page,
       pricing_information_page, verification_status, confidence_score,
       last_verified_at, evidence_count, created_by, created_at, updated_at
     ) values ($1, $2, $3, $4, $5, null, $6, $7, $8, $9, $10, null, null,
               null, null, 'verified', 95, $11, 3, $12, $11, $11)`,
    [
      softwareId,
      "Garage Cloud",
      toJson([]),
      "Garage Cloud SAS",
      `${softwareId}.example.test`,
      toJson(["Europe"]),
      toJson(["fr"]),
      toJson(["Automobile"]),
      toJson(["Gestion de garage"]),
      `https://${softwareId}.example.test`,
      now,
      userId,
    ],
  );
  await db.query(
    `insert into api_products (
       id, software_id, name, api_style, version, base_url, documentation_url,
       openapi_url, postman_collection_url, graphql_schema_url,
       authentication_type, oauth_metadata, scopes, webhook_support,
       sandbox_support, partner_access_requirement, access_level,
       rate_limit_information, deprecation_status, terms_url, confidence_score,
       last_verified_at, created_at, updated_at
     ) values ($1, $2, 'Garage Cloud API', 'rest', '1', $3, $4, null, null,
               null, 'oauth2', $5, $6, 0, 1, 0, 'public', null, 'active',
               null, 95, $7, $7, $7)`,
    [
      apiProductId,
      softwareId,
      `https://${softwareId}.example.test/api`,
      `https://${softwareId}.example.test/docs`,
      toJson({}),
      toJson([]),
      now,
    ],
  );
  await db.query(
    `insert into api_sources (
       id, software_id, api_product_id, canonical_url, source_type,
       source_classification, publisher_domain, created_by, created_at
     ) values ($1, $2, $3, $4, 'official_openapi_specification', 'official',
               $5, $6, $7)`,
    [
      sourceId,
      softwareId,
      apiProductId,
      `https://${softwareId}.example.test/openapi.json`,
      `${softwareId}.example.test`,
      userId,
      now,
    ],
  );
  await db.query(
    `insert into api_source_snapshots (
       id, source_id, retrieved_at, http_status, etag, last_modified,
       content_hash, parser_version, robots_decision, access_policy_decision,
       content_type, content, safe_metadata, created_at
     ) values ($1, $2, $3, 200, null, null, $4, 'openapi-1', 'allowed',
               'allowed', 'application/json', '{}', $5, $3)`,
    [snapshotId, sourceId, now, "a".repeat(64), toJson({})],
  );
  for (const [claimId, subjectType, subjectId, claimType] of [
    [productClaimId, "api_product", apiProductId, "api_metadata"],
    [readOperationClaimId, "api_operation", readOperationId, "operation_exists"],
    [writeOperationClaimId, "api_operation", writeOperationId, "operation_exists"],
  ]) {
    if (subjectType === "api_operation") {
      const isRead = subjectId === readOperationId;
      await db.query(
        `insert into api_operations (
           id, api_product_id, source_snapshot_id, operation_key, method, path,
           summary, tags, capability, deprecated, request_schema_ref,
           response_schema_ref, security_requirements, created_at
         ) values ($1, $2, $3, $4, $5, '/customers', $6, $7, $8, 0, null,
                   null, $9, $10)`,
        [
          subjectId,
          apiProductId,
          snapshotId,
          isRead ? "listCustomers" : "createCustomer",
          isRead ? "get" : "post",
          isRead ? "Lister les clients" : "Créer un client",
          toJson(["customers"]),
          isRead ? "read" : "write",
          toJson([]),
          now,
        ],
      );
    }
    await db.query(
      `insert into api_claims (
         id, source_snapshot_id, subject_type, subject_id, claim_type,
         claim_value, confidence, approval_status, created_at
       ) values ($1, $2, $3, $4, $5, $6, 'high', 'approved', $7)`,
      [claimId, snapshotId, subjectType, subjectId, claimType, toJson({}), now],
    );
  }
  await db.query(
    `insert into api_evidence (
       id, claim_id, source_snapshot_id, locator, excerpt_hash, created_at
     ) values ($1, $2, $3, '#', $4, $5)`,
    [productEvidenceId, productClaimId, snapshotId, "b".repeat(64), now],
  );
  await db.query(
    `insert into api_tenant_mappings (
       id, tenant_id, api_product_id, source_entity, canonical_entity,
       source_field, canonical_field, confidence, evidence_id,
       approval_status, version, created_by, approved_by, created_at, updated_at
     ) values ($1, $2, $3, 'Customer', 'Contact', null, null, 95, $4,
               'approved', 1, $5, $5, $6, $6)`,
    [id("mapping"), tenantId, apiProductId, productEvidenceId, userId, now],
  );
  const manifest = {
    manifestVersion: "1",
    connectorKey: "garage_cloud_1",
    name: "Garage Cloud Contacts",
    version: "0.1.0",
    enabled: false,
    apiProductId,
    authentication: { type: "oauth2" },
    capabilities: [
      {
        operationKey: "listCustomers",
        method: "get",
        path: "/customers",
        direction: "read",
        timeoutMs: 10_000,
        idempotencyRequired: false,
      },
      {
        operationKey: "createCustomer",
        method: "post",
        path: "/customers",
        direction: "write",
        timeoutMs: 10_000,
        idempotencyRequired: true,
      },
    ],
    mappings: [{ sourceEntity: "Customer", canonicalEntity: "Contact" }],
    pagination: { strategy: "none" },
    retry: { maxAttempts: 3, backoff: "exponential" },
    rateLimit: { strategy: "respect_headers" },
    webhooks: { supported: false },
    fixtureVersion: "1",
  };
  await db.query(
    `insert into connector_proposals (
       id, tenant_id, software_id, api_product_id, name, version, status,
       enabled, manifest, unresolved_questions, risk_assessment, created_by,
       created_at, updated_at
     ) values ($1, $2, $3, $4, 'Garage Cloud Contacts', '0.1.0',
               'approved_for_sandbox', 0, $5, $6, $7, $8, $9, $9)`,
    [
      proposalId,
      tenantId,
      softwareId,
      apiProductId,
      toJson(manifest),
      toJson([]),
      toJson({ liveWritesAllowed: false }),
      userId,
      now,
    ],
  );
  await db.query(
    `insert into connector_contract_runs (
       id, tenant_id, connector_proposal_id, connector_version, api_version,
       test_suite_version, environment, status, results, safe_logs, created_at
     ) values ($1, $2, $3, '0.1.0', '1', 'contract-1', 'mock', 'passed',
               $4, $5, $6)`,
    [contractRunId, tenantId, proposalId, toJson([]), toJson(["passed"]), now],
  );
  await db.query(
    `insert into private_connect_store_entries (
       id, tenant_id, connector_proposal_id, verification_status,
       installation_status, last_tested_at, known_limitations, created_at,
       updated_at
     ) values ($1, $2, $3, 'approved_for_sandbox', 'not_installed', $4, $5,
               $4, $4)`,
    [
      storeEntryId,
      tenantId,
      proposalId,
      now,
      toJson(["Sandbox uniquement"]),
    ],
  );
  return { storeEntryId, proposalId, writeOperationClaimId };
}

async function countOperationalEffects(
  db: Awaited<ReturnType<typeof createMemoryDb>>,
  tenantId: string,
) {
  const result = await db.query<{
    accounts: number | string;
    credentials: number | string;
    sync_runs: number | string;
    domain_events: number | string;
    notifications: number | string;
  }>(
    `select
       (select count(*) from connector_accounts where tenant_id = $1) as accounts,
       (select count(*) from connector_credentials where tenant_id = $1) as credentials,
       (select count(*) from connector_sync_runs where tenant_id = $1) as sync_runs,
       (select count(*) from domain_events where tenant_id = $1) as domain_events,
       (select count(*) from notifications where tenant_id = $1) as notifications`,
    [tenantId],
  );
  return {
    accounts: Number(result.rows[0]?.accounts ?? 0),
    credentials: Number(result.rows[0]?.credentials ?? 0),
    syncRuns: Number(result.rows[0]?.sync_runs ?? 0),
    domainEvents: Number(result.rows[0]?.domain_events ?? 0),
    notifications: Number(result.rows[0]?.notifications ?? 0),
  };
}
