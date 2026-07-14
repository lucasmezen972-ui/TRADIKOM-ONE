import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { pgPoolAsSqlClient } from "../src/db/client";
import { migrate } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import { id, nowIso, toJson } from "../src/lib/security";
import { createDatabaseRateLimiter } from "../src/modules/rate-limit";

const databaseUrl = process.env.DATABASE_URL;
const describeIfPostgres = databaseUrl ? describe : describe.skip;
const ownerPools: Pool[] = [];
const restrictedPools: Pool[] = [];
const restrictedRoles: Array<{ ownerPool: Pool; roleName: string }> = [];

afterEach(async () => {
  await Promise.all(restrictedPools.splice(0).map((pool) => pool.end()));
  for (const role of restrictedRoles.splice(0)) {
    await dropRestrictedRole(role.ownerPool, role.roleName);
  }
  await Promise.all(ownerPools.splice(0).map((pool) => pool.end()));
});

describeIfPostgres("PostgreSQL RLS", () => {
  it("isolates tenant-owned rows for a restricted non-owner database role", async () => {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for this test.");
    }

    const ownerPool = new Pool({ connectionString: databaseUrl });
    ownerPools.push(ownerPool);
    const ownerDb = pgPoolAsSqlClient(ownerPool);
    await migrate(ownerDb, { enableRls: true });

    const services = createServices(ownerDb);
    const ownerA = await services.registerUser({
      name: "RLS Owner A",
      email: uniqueEmail("rls-owner-a"),
      password: "Password!1",
    });
    const ownerB = await services.registerUser({
      name: "RLS Owner B",
      email: uniqueEmail("rls-owner-b"),
      password: "Password!1",
    });
    const tenantA = await services.createTenant(ownerA.id, {
      name: `Garage RLS A ${randomUUID()}`,
      category: "Garage automobile",
    });
    const tenantB = await services.createTenant(ownerB.id, {
      name: `Garage RLS B ${randomUUID()}`,
      category: "Garage automobile",
    });
    const contactAId = await insertContact(
      ownerDb,
      tenantA.id,
      ownerA.id,
      "alpha@example.com",
    );
    const contactBId = await insertContact(
      ownerDb,
      tenantB.id,
      ownerB.id,
      "bravo@example.com",
    );
    const apiIntelligence = await insertApiIntelligenceTenantFixtures(
      ownerDb,
      tenantA.id,
      tenantB.id,
      ownerA.id,
    );

    const policyGaps = await ownerPool.query<{ table_name: string }>(`
      select columns.table_name
      from information_schema.columns as columns
      join pg_class as tables on tables.relname = columns.table_name
      join pg_namespace as namespaces on namespaces.oid = tables.relnamespace
      where columns.table_schema = 'public'
        and columns.column_name = 'tenant_id'
        and namespaces.nspname = 'public'
        and (
          not tables.relrowsecurity
          or not exists (
            select 1
            from pg_policies as policies
            where policies.schemaname = 'public'
              and policies.tablename = columns.table_name
              and policies.cmd = 'ALL'
          )
        )
      order by columns.table_name
    `);
    expect(policyGaps.rows).toEqual([]);

    const tenantIndexGaps = await ownerPool.query<{ table_name: string }>(`
      select columns.table_name
      from information_schema.columns as columns
      where columns.table_schema = 'public'
        and columns.column_name = 'tenant_id'
        and not exists (
          select 1
          from pg_index as indexes
          join pg_class as tables on tables.oid = indexes.indrelid
          join pg_namespace as namespaces on namespaces.oid = tables.relnamespace
          join pg_attribute as attributes
            on attributes.attrelid = indexes.indrelid
           and attributes.attnum = any(indexes.indkey)
          where namespaces.nspname = 'public'
            and tables.relname = columns.table_name
            and attributes.attname = 'tenant_id'
        )
      order by columns.table_name
    `);
    expect(tenantIndexGaps.rows).toEqual([]);

    const tenantPolicy = await ownerPool.query<{ relrowsecurity: boolean }>(`
      select tables.relrowsecurity
      from pg_class as tables
      join pg_namespace as namespaces on namespaces.oid = tables.relnamespace
      where namespaces.nspname = 'public'
        and tables.relname = 'tenants'
        and exists (
          select 1
          from pg_policies as policies
          where policies.schemaname = 'public'
            and policies.tablename = 'tenants'
            and policies.cmd = 'ALL'
        )
    `);
    expect(tenantPolicy.rows).toEqual([{ relrowsecurity: true }]);

    const restricted = await createRestrictedRole(ownerPool);
    restrictedRoles.push({ ownerPool, roleName: restricted.roleName });
    const restrictedPool = new Pool({ connectionString: restricted.databaseUrl });
    restrictedPools.push(restrictedPool);

    const noContext = await restrictedPool.query<{ email: string }>(
      "select email from contacts order by email",
    );
    expect(noContext.rows).toEqual([]);

    const attemptedSystemBypass = await withSystemAccessFlag(
      restrictedPool,
      async (client) =>
        client.query<{ email: string }>("select email from contacts order by email"),
    );
    expect(attemptedSystemBypass.rows).toEqual([]);

    const tenantARows = await withTenantContext(
      restrictedPool,
      tenantA.id,
      async (client) =>
        client.query<{ email: string }>("select email from contacts order by email"),
    );
    expect(tenantARows.rows.map((row) => row.email)).toEqual([
      "alpha@example.com",
    ]);

    const criticalTenantRows = await withTenantContext(
      restrictedPool,
      tenantA.id,
      async (client) => {
        const tenants = await client.query<{ id: string }>(
          "select id from tenants order by id",
        );
        const memberships = await client.query<{ tenant_id: string }>(
          "select distinct tenant_id from memberships order by tenant_id",
        );
        const workflows = await client.query<{ tenant_id: string }>(
          "select distinct tenant_id from workflows order by tenant_id",
        );
        const webhookEndpoints = await client.query<{ tenant_id: string }>(
          "select distinct tenant_id from webhook_endpoints order by tenant_id",
        );
        const connectorSecrets = await client.query<{ tenant_id: string }>(
          "select distinct tenant_id from connector_secret_versions order by tenant_id",
        );
        const connectorProposals = await client.query<{
          id: string;
          tenant_id: string;
        }>("select id, tenant_id from connector_proposals order by id");
        const apiChangeImpacts = await client.query<{
          id: string;
          tenant_id: string;
        }>("select id, tenant_id from api_change_impacts order by id");
        const connectorRepairs = await client.query<{
          id: string;
          tenant_id: string;
        }>("select id, tenant_id from connector_repair_proposals order by id");

        return {
          tenants: tenants.rows,
          memberships: memberships.rows,
          workflows: workflows.rows,
          webhookEndpoints: webhookEndpoints.rows,
          connectorSecrets: connectorSecrets.rows,
          connectorProposals: connectorProposals.rows,
          apiChangeImpacts: apiChangeImpacts.rows,
          connectorRepairs: connectorRepairs.rows,
        };
      },
    );
    expect(criticalTenantRows).toEqual({
      tenants: [{ id: tenantA.id }],
      memberships: [{ tenant_id: tenantA.id }],
      workflows: [{ tenant_id: tenantA.id }],
      webhookEndpoints: [{ tenant_id: tenantA.id }],
      connectorSecrets: [{ tenant_id: tenantA.id }],
      connectorProposals: [
        { id: apiIntelligence.proposalAId, tenant_id: tenantA.id },
        { id: apiIntelligence.replacementAId, tenant_id: tenantA.id },
      ],
      apiChangeImpacts: [
        { id: apiIntelligence.impactAId, tenant_id: tenantA.id },
      ],
      connectorRepairs: [
        { id: apiIntelligence.repairAId, tenant_id: tenantA.id },
      ],
    });

    await expect(
      withTenantContext(restrictedPool, tenantA.id, async (client) =>
        client.query(
          `insert into contacts (id, tenant_id, name, email, phone, status, source, tags, assigned_user_id, created_at, updated_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            id("contact"),
            tenantB.id,
            "Cross Tenant",
            "cross@example.com",
            "+596 696 00 00 00",
            "Nouveau",
            "test",
            toJson(["test"]),
            ownerA.id,
            nowIso(),
            nowIso(),
          ],
        ),
      ),
    ).rejects.toThrow(/row-level security|violates/);

    const sameTenantLeadId = id("lead");
    await withTenantContext(restrictedPool, tenantA.id, async (client) =>
      client.query(
        `insert into leads (id, tenant_id, contact_id, source, status, opportunity_value, page_path, created_at)
         values ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          sameTenantLeadId,
          tenantA.id,
          contactAId,
          "rls_test",
          "Nouveau",
          0,
          "/rls",
          nowIso(),
        ],
      ),
    );

    await expect(
      withTenantContext(restrictedPool, tenantA.id, async (client) =>
        client.query(
          `insert into leads (id, tenant_id, contact_id, source, status, opportunity_value, page_path, created_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            id("lead"),
            tenantA.id,
            contactBId,
            "rls_test",
            "Nouveau",
            0,
            "/rls-cross-tenant",
            nowIso(),
          ],
        ),
      ),
    ).rejects.toThrow(/Cross-tenant relation|Related tenant row/);

    await expect(
      withTenantContext(restrictedPool, tenantA.id, async (client) =>
        client.query(
          `insert into api_change_impacts (
             id, tenant_id, api_change_event_id, connector_proposal_id,
             contract_run_id, status, upgrade_blocked, repair_proposal,
             contract_test_status, contract_test_results, approval_status,
             decided_by, decision_reason, decided_at, created_at, updated_at
           ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                     $12, $13, $14, $15, $16)`,
          [
            id("impact"),
            tenantA.id,
            apiIntelligence.changeEventId,
            apiIntelligence.proposalBId,
            null,
            "review_required",
            1,
            toJson({ enabled: false }),
            "failed",
            toJson({ safeToUpgrade: false }),
            "pending",
            null,
            null,
            null,
            nowIso(),
            nowIso(),
          ],
        ),
      ),
    ).rejects.toThrow(
      /Cross-tenant relation|Related tenant row|Invalid API change impact relation/,
    );

    await expect(
      withTenantContext(restrictedPool, tenantA.id, async (client) =>
        client.query(
          `update connector_repair_proposals
           set replacement_connector_proposal_id = $1
           where tenant_id = $2 and id = $3`,
          [
            apiIntelligence.replacementBId,
            tenantA.id,
            apiIntelligence.repairAId,
          ],
        ),
      ),
    ).rejects.toThrow(
      /Cross-tenant relation|Related tenant row|Invalid connector repair relation/,
    );

    await expect(
      withTenantContext(restrictedPool, tenantA.id, async (client) =>
        client.query(
          `insert into workflow_runs (id, tenant_id, workflow_key, trigger_name, status, summary, error, retry_count, created_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            id("workflow_run"),
            tenantB.id,
            "lead_follow_up",
            "lead.created",
            "running",
            "Cross tenant write",
            null,
            0,
            nowIso(),
          ],
        ),
      ),
    ).rejects.toThrow(/row-level security|violates/);

    await expect(
      withTenantContext(restrictedPool, tenantA.id, async (client) =>
        client.query(
          `insert into connector_contract_runs (
             id, tenant_id, connector_proposal_id, connector_version,
             api_version, test_suite_version, environment, status, results,
             safe_logs, created_at
           ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            id("contract"),
            tenantA.id,
            apiIntelligence.proposalBId,
            "0.1.0",
            "1",
            "contract-1",
            "mock",
            "passed",
            toJson([]),
            toJson([]),
            nowIso(),
          ],
        ),
      ),
    ).rejects.toThrow(/Cross-tenant relation|Related tenant row/);
  });

  it("isolates Business Brain entries and their evidence", async () => {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for this test.");
    }

    const ownerPool = new Pool({ connectionString: databaseUrl });
    ownerPools.push(ownerPool);
    const ownerDb = pgPoolAsSqlClient(ownerPool);
    await migrate(ownerDb, { enableRls: true });
    const services = createServices(ownerDb);
    const ownerA = await services.registerUser({
      name: "Brain RLS Owner A",
      email: uniqueEmail("brain-rls-owner-a"),
      password: "Password!1",
    });
    const ownerB = await services.registerUser({
      name: "Brain RLS Owner B",
      email: uniqueEmail("brain-rls-owner-b"),
      password: "Password!1",
    });
    const tenantA = await services.createTenant(ownerA.id, {
      name: `Brain RLS A ${randomUUID()}`,
      category: "Services",
    });
    const tenantB = await services.createTenant(ownerB.id, {
      name: `Brain RLS B ${randomUUID()}`,
      category: "Services",
    });
    const entryA = await services.createBusinessBrainEntry(
      ownerA.id,
      tenantA.id,
      businessBrainFixture("Tenant A"),
    );
    const entryB = await services.createBusinessBrainEntry(
      ownerB.id,
      tenantB.id,
      businessBrainFixture("Tenant B"),
    );
    const strategicA = await services.generateStrategicRecommendations(
      ownerA.id,
      tenantA.id,
    );
    const strategicB = await services.generateStrategicRecommendations(
      ownerB.id,
      tenantB.id,
    );
    const recommendationA = strategicA.createdIds[0];
    const recommendationB = strategicB.createdIds[0];
    if (!recommendationA || !recommendationB) {
      throw new Error("Strategic RLS fixtures are missing.");
    }

    const restricted = await createRestrictedRole(ownerPool);
    restrictedRoles.push({ ownerPool, roleName: restricted.roleName });
    const restrictedPool = new Pool({ connectionString: restricted.databaseUrl });
    restrictedPools.push(restrictedPool);

    const noContext = await restrictedPool.query<{ id: string }>(
      "select id from business_brain_entries order by id",
    );
    expect(noContext.rows).toEqual([]);

    const tenantAView = await withTenantContext(
      restrictedPool,
      tenantA.id,
      async (client) => {
        const entries = await client.query<{ id: string; tenant_id: string }>(
          "select id, tenant_id from business_brain_entries order by id",
        );
        const evidence = await client.query<{
          entry_id: string;
          tenant_id: string;
        }>("select entry_id, tenant_id from business_brain_evidence order by id");
        const recommendations = await client.query<{
          id: string;
          tenant_id: string;
        }>("select id, tenant_id from strategic_recommendations order by id");
        const strategicEvidence = await client.query<{
          recommendation_id: string;
          tenant_id: string;
        }>(
          "select recommendation_id, tenant_id from strategic_recommendation_evidence order by id",
        );
        return {
          entries: entries.rows,
          evidence: evidence.rows,
          recommendations: recommendations.rows,
          strategicEvidence: strategicEvidence.rows,
        };
      },
    );
    expect(tenantAView).toEqual({
      entries: [{ id: entryA, tenant_id: tenantA.id }],
      evidence: [{ entry_id: entryA, tenant_id: tenantA.id }],
      recommendations: [{ id: recommendationA, tenant_id: tenantA.id }],
      strategicEvidence: [
        { recommendation_id: recommendationA, tenant_id: tenantA.id },
      ],
    });

    await expect(
      withTenantContext(restrictedPool, tenantA.id, async (client) =>
        client.query(
          `insert into business_brain_evidence (
             id, tenant_id, entry_id, evidence_type, source_ref, summary,
             captured_at, created_by, created_at
           ) values ($1, $2, $3, 'observation', null, $4, $5, $6, $5)`,
          [
            id("brain_evidence"),
            tenantA.id,
            entryB,
            "Preuve étrangère refusée.",
            nowIso(),
            ownerA.id,
          ],
        ),
      ),
    ).rejects.toThrow(/foreign key|row-level security|violates/);

    await expect(
      withTenantContext(restrictedPool, tenantA.id, async (client) =>
        client.query(
          `insert into strategic_recommendation_evidence (
             id, tenant_id, recommendation_id, evidence_type, evidence_ref,
             label, observed_value, captured_at, created_at
           ) values ($1, $2, $3, 'system_metric', 'cross-tenant', $4, $5, $6, $6)`,
          [
            id("strategic_evidence"),
            tenantA.id,
            recommendationB,
            "Preuve étrangère",
            "refusée",
            nowIso(),
          ],
        ),
      ),
    ).rejects.toThrow(/foreign key|row-level security|violates/);
  });

  it("consumes rate limits atomically under PostgreSQL concurrency", async () => {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for this test.");
    }

    const ownerPool = new Pool({ connectionString: databaseUrl, max: 25 });
    ownerPools.push(ownerPool);
    const ownerDb = pgPoolAsSqlClient(ownerPool);
    await migrate(ownerDb, { enableRls: true });
    const limiter = createDatabaseRateLimiter(ownerDb);
    const nonce = randomUUID();
    const subject = `postgres-concurrency-${nonce}@example.com`;
    const scope = `tenant-${nonce}`;
    const now = new Date("2026-07-12T22:45:00.000Z");
    const decisions = await Promise.all(
      Array.from({ length: 20 }, () =>
        limiter.consume({
          operationKey: "login",
          subjectKey: subject,
          scopeKey: scope,
          limit: 5,
          windowSeconds: 60,
          now,
        }),
      ),
    );

    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(5);
    expect(decisions.filter((decision) => !decision.allowed)).toHaveLength(15);
    expect(Math.max(...decisions.map((decision) => decision.count))).toBe(20);

    const stored = await ownerDb.query<Record<string, unknown>>(
      "select * from rate_limits where operation_key = $1 order by created_at desc limit 1",
      ["login"],
    );
    expect(JSON.stringify(stored.rows[0])).not.toContain(subject);
    expect(JSON.stringify(stored.rows[0])).not.toContain(scope);
  });
});

function businessBrainFixture(label: string) {
  return {
    domain: "company" as const,
    title: `Mémoire ${label}`,
    summary: `Information vérifiée pour ${label}.`,
    details: "",
    confidence: 90,
    sourceType: "manual" as const,
    evidenceType: "observation" as const,
    evidenceSummary: `Observation validée pour ${label}.`,
  };
}

async function insertContact(
  db: ReturnType<typeof pgPoolAsSqlClient>,
  tenantId: string,
  ownerId: string,
  email: string,
) {
  const now = nowIso();
  const contactId = id("contact");
  await db.query(
    `insert into contacts (id, tenant_id, name, email, phone, status, source, tags, assigned_user_id, created_at, updated_at)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      contactId,
      tenantId,
      email,
      email,
      "+596 696 00 00 00",
      "Nouveau",
      "test",
      toJson(["test"]),
      ownerId,
      now,
      now,
    ],
  );
  return contactId;
}

async function insertApiIntelligenceTenantFixtures(
  db: ReturnType<typeof pgPoolAsSqlClient>,
  tenantAId: string,
  tenantBId: string,
  ownerId: string,
) {
  const now = nowIso();
  const softwareId = id("software");
  const apiProductId = id("api");
  const proposalAId = id("proposal_a");
  const proposalBId = id("proposal_b");
  const replacementAId = id("proposal_repair_a");
  const replacementBId = id("proposal_repair_b");
  const sourceId = id("source");
  const previousSnapshotId = id("snapshot_previous");
  const currentSnapshotId = id("snapshot_current");
  const changeEventId = id("api_change");
  const impactAId = id("impact_a");
  const impactBId = id("impact_b");
  const repairAId = id("repair_a");
  const repairBId = id("repair_b");
  await db.query(
    `insert into software_directory_entries (
       id, canonical_name, aliases, vendor, official_domain, country,
       supported_regions, languages, industries, categories,
       official_website, developer_portal, support_page,
       partner_program_page, pricing_information_page, verification_status,
       confidence_score, last_verified_at, evidence_count, created_by,
       created_at, updated_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
               $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)`,
    [
      softwareId,
      `RLS Software ${softwareId}`,
      toJson([]),
      "RLS Vendor",
      `${softwareId}.example.test`,
      null,
      toJson([]),
      toJson(["fr"]),
      toJson([]),
      toJson([]),
      `https://${softwareId}.example.test/`,
      null,
      null,
      null,
      null,
      "verified",
      100,
      now,
      1,
      ownerId,
      now,
      now,
    ],
  );
  await db.query(
    `insert into api_products (
       id, software_id, name, api_style, version, base_url,
       documentation_url, openapi_url, postman_collection_url,
       graphql_schema_url, authentication_type, oauth_metadata, scopes,
       webhook_support, sandbox_support, partner_access_requirement,
       access_level, rate_limit_information, deprecation_status, terms_url,
       confidence_score, last_verified_at, created_at, updated_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
               $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23, $24)`,
    [
      apiProductId,
      softwareId,
      "RLS API",
      "rest",
      "1",
      "https://api.example.test",
      "https://docs.example.test",
      null,
      null,
      null,
      "none",
      toJson({}),
      toJson([]),
      0,
      1,
      0,
      "public",
      null,
      "active",
      null,
      100,
      now,
      now,
      now,
    ],
  );
  for (const [proposalId, tenantId] of [
    [proposalAId, tenantAId],
    [proposalBId, tenantBId],
    [replacementAId, tenantAId],
    [replacementBId, tenantBId],
  ]) {
    await db.query(
      `insert into connector_proposals (
         id, tenant_id, software_id, api_product_id, name, version, status,
         enabled, manifest, unresolved_questions, risk_assessment, created_by,
         created_at, updated_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        proposalId,
        tenantId,
        softwareId,
        apiProductId,
        `RLS Connector ${tenantId}`,
        "0.1.0",
        "static_checks_passed",
        0,
        toJson({ enabled: false }),
        toJson([]),
        toJson({ level: "low" }),
        ownerId,
        now,
        now,
      ],
    );
  }
  await db.query(
    `insert into api_sources (
       id, software_id, api_product_id, canonical_url, source_type,
       source_classification, publisher_domain, created_by, created_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [
      sourceId,
      softwareId,
      apiProductId,
      `https://${softwareId}.example.test/openapi.json`,
      "official_openapi_specification",
      "official",
      `${softwareId}.example.test`,
      ownerId,
      now,
    ],
  );
  for (const [snapshotId, hash, etag] of [
    [previousSnapshotId, "a".repeat(64), '"v1"'],
    [currentSnapshotId, "b".repeat(64), '"v2"'],
  ]) {
    await db.query(
      `insert into api_source_snapshots (
         id, source_id, retrieved_at, http_status, etag, last_modified,
         content_hash, parser_version, robots_decision,
         access_policy_decision, content_type, content, safe_metadata,
         created_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        snapshotId,
        sourceId,
        now,
        200,
        etag,
        null,
        hash,
        "openapi-1",
        "allowed",
        "allowed",
        "application/json",
        "{}",
        toJson({}),
        now,
      ],
    );
  }
  await db.query(
    `insert into api_change_events (
       id, api_product_id, source_id, previous_snapshot_id,
       current_snapshot_id, primary_classification, classifications,
       summary, requires_approval, detected_at, created_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [
      changeEventId,
      apiProductId,
      sourceId,
      previousSnapshotId,
      currentSnapshotId,
      "breaking",
      toJson(["breaking"]),
      toJson({ monitorVersion: "api-change-1", changes: [] }),
      1,
      now,
      now,
    ],
  );
  for (const [impactId, tenantId, proposalId] of [
    [impactAId, tenantAId, proposalAId],
    [impactBId, tenantBId, proposalBId],
  ]) {
    await db.query(
      `insert into api_change_impacts (
         id, tenant_id, api_change_event_id, connector_proposal_id,
         contract_run_id, status, upgrade_blocked, repair_proposal,
         contract_test_status, contract_test_results, approval_status,
         decided_by, decision_reason, decided_at, created_at, updated_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
                 $12, $13, $14, $15, $16)`,
      [
        impactId,
        tenantId,
        changeEventId,
        proposalId,
        null,
        "review_required",
        1,
        toJson({ enabled: false }),
        "failed",
        toJson({ safeToUpgrade: false }),
        "pending",
        null,
        null,
        null,
        now,
        now,
      ],
    );
  }
  for (const [repairId, tenantId, impactId, sourceProposalId, replacementId] of [
    [repairAId, tenantAId, impactAId, proposalAId, replacementAId],
    [repairBId, tenantBId, impactBId, proposalBId, replacementBId],
  ]) {
    await db.query(
      `insert into connector_repair_proposals (
         id, tenant_id, api_change_impact_id, source_connector_proposal_id,
         replacement_connector_proposal_id, source_snapshot_id,
         generation_summary, created_by, created_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        repairId,
        tenantId,
        impactId,
        sourceProposalId,
        replacementId,
        currentSnapshotId,
        toJson({ generatorVersion: "connector-repair-1", enabled: false }),
        ownerId,
        now,
      ],
    );
  }
  return {
    proposalAId,
    proposalBId,
    replacementAId,
    replacementBId,
    changeEventId,
    impactAId,
    impactBId,
    repairAId,
    repairBId,
  };
}

async function createRestrictedRole(ownerPool: Pool) {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required for restricted role creation.");
  }

  const roleName = `tradikom_rls_${randomUUID().replaceAll("-", "")}`;
  const password = randomUUID().replaceAll("-", "");
  const roleIdentifier = quoteIdentifier(roleName);

  await ownerPool.query(
    `create role ${roleIdentifier} login password ${quoteLiteral(password)}`,
  );
  await ownerPool.query(`grant usage on schema public to ${roleIdentifier}`);
  await ownerPool.query(
    `grant select, insert, update, delete on all tables in schema public to ${roleIdentifier}`,
  );

  const restrictedUrl = new URL(databaseUrl);
  restrictedUrl.username = roleName;
  restrictedUrl.password = password;

  return { roleName, databaseUrl: restrictedUrl.toString() };
}

async function dropRestrictedRole(ownerPool: Pool, roleName: string) {
  const roleIdentifier = quoteIdentifier(roleName);
  await ownerPool.query(`drop owned by ${roleIdentifier}`);
  await ownerPool.query(`drop role if exists ${roleIdentifier}`);
}

async function withTenantContext<T>(
  pool: Pool,
  tenantId: string,
  callback: (client: PoolClient) => Promise<T>,
) {
  const client = await pool.connect();

  try {
    await client.query("begin");
    await client.query("select set_config('app.tenant_id', $1, true)", [tenantId]);
    const result = await callback(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function withSystemAccessFlag<T>(
  pool: Pool,
  callback: (client: PoolClient) => Promise<T>,
) {
  const client = await pool.connect();

  try {
    await client.query("begin");
    await client.query("select set_config('app.system_access', 'true', true)");
    const result = await callback(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

function uniqueEmail(prefix: string) {
  return `${prefix}-${randomUUID()}@example.com`;
}

function quoteIdentifier(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

function quoteLiteral(value: string) {
  return `'${value.replaceAll("'", "''")}'`;
}
