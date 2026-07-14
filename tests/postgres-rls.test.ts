import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";
import { pgPoolAsSqlClient } from "../src/db/client";
import { migrate } from "../src/lib/db";
import { defaultGarageOnboarding } from "../src/lib/generation";
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
    await services.saveOnboarding(ownerA.id, tenantA.id, defaultGarageOnboarding());
    await services.saveOnboarding(ownerB.id, tenantB.id, defaultGarageOnboarding());
    const marketingA = await services.generateMarketingCampaignProposals(
      ownerA.id,
      tenantA.id,
    );
    const marketingB = await services.generateMarketingCampaignProposals(
      ownerB.id,
      tenantB.id,
    );
    const proposalB = marketingB.createdIds[0];
    if (marketingA.createdIds.length === 0 || !proposalB) {
      throw new Error("Marketing RLS fixtures are missing.");
    }
    const websiteAiA = await services.generateWebsiteAiProposals(ownerA.id, tenantA.id);
    const websiteAiB = await services.generateWebsiteAiProposals(ownerB.id, tenantB.id);
    const websiteAiProposalB = websiteAiB.createdIds[0];
    const websiteB = await services.getWebsiteWorkspace(ownerB.id, tenantB.id);
    const websiteBId = websiteB.website?.id;
    const websiteBSectionId = websiteB.sections[0]?.id;
    if (
      websiteAiA.createdIds.length === 0 ||
      !websiteAiProposalB ||
      !websiteBId ||
      !websiteBSectionId
    ) {
      throw new Error("Website AI RLS fixtures are missing.");
    }

    const restricted = await createRestrictedRole(ownerPool);
    restrictedRoles.push({ ownerPool, roleName: restricted.roleName });
    const restrictedPool = new Pool({ connectionString: restricted.databaseUrl });
    restrictedPools.push(restrictedPool);

    const noContext = await restrictedPool.query<{ id: string }>(
      "select id from business_brain_entries order by id",
    );
    expect(noContext.rows).toEqual([]);
    const noMarketingContext = await restrictedPool.query<{ id: string }>(
      "select id from marketing_campaign_proposals order by id",
    );
    expect(noMarketingContext.rows).toEqual([]);
    const noWebsiteAiContext = await restrictedPool.query<{ id: string }>(
      "select id from website_ai_proposals order by id",
    );
    expect(noWebsiteAiContext.rows).toEqual([]);

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
        const marketing = await client.query<{
          id: string;
          tenant_id: string;
        }>("select id, tenant_id from marketing_campaign_proposals order by id");
        const marketingEvidence = await client.query<{
          proposal_id: string;
          tenant_id: string;
        }>(
          "select proposal_id, tenant_id from marketing_campaign_evidence order by proposal_id, id",
        );
        const websiteAi = await client.query<{
          id: string;
          tenant_id: string;
        }>("select id, tenant_id from website_ai_proposals order by id");
        const websiteAiEvidence = await client.query<{
          proposal_id: string;
          tenant_id: string;
        }>(
          "select proposal_id, tenant_id from website_ai_evidence order by proposal_id, id",
        );
        return {
          entries: entries.rows,
          evidence: evidence.rows,
          recommendations: recommendations.rows,
          strategicEvidence: strategicEvidence.rows,
          marketing: marketing.rows,
          marketingEvidence: marketingEvidence.rows,
          websiteAi: websiteAi.rows,
          websiteAiEvidence: websiteAiEvidence.rows,
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
      marketing: marketingA.createdIds
        .map((id) => ({ id, tenant_id: tenantA.id }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      marketingEvidence: marketingA.createdIds
        .flatMap((proposalId) => [
          { proposal_id: proposalId, tenant_id: tenantA.id },
          { proposal_id: proposalId, tenant_id: tenantA.id },
          { proposal_id: proposalId, tenant_id: tenantA.id },
        ])
        .sort((left, right) => left.proposal_id.localeCompare(right.proposal_id)),
      websiteAi: websiteAiA.createdIds
        .map((id) => ({ id, tenant_id: tenantA.id }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      websiteAiEvidence: websiteAiA.createdIds
        .flatMap((proposalId, index) =>
          Array.from({ length: index === 0 ? 3 : 2 }, () => ({
            proposal_id: proposalId,
            tenant_id: tenantA.id,
          })),
        )
        .sort((left, right) => left.proposal_id.localeCompare(right.proposal_id)),
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

    await expect(
      withTenantContext(restrictedPool, tenantA.id, async (client) =>
        client.query(
          `insert into marketing_campaign_evidence (
             id, tenant_id, proposal_id, evidence_type, evidence_ref, label,
             observed_value, captured_at, created_at
           ) values ($1, $2, $3, 'business_profile', $4, $5, $6, $7, $7)`,
          [
            id("marketing_evidence"),
            tenantA.id,
            proposalB,
            tenantB.id,
            "Preuve étrangère",
            "refusée",
            nowIso(),
          ],
        ),
      ),
    ).rejects.toThrow(/foreign key|row-level security|violates/);

    await expect(
      withTenantContext(restrictedPool, tenantA.id, async (client) =>
        client.query(
          `insert into website_ai_evidence (
             id, tenant_id, proposal_id, evidence_type, evidence_ref, label,
             observed_value, captured_at, created_at
           ) values ($1, $2, $3, 'website_section', $4, $5, $6, $7, $7)`,
          [
            id("website_ai_evidence"),
            tenantA.id,
            websiteAiProposalB,
            websiteBSectionId,
            "Section étrangère",
            "refusée",
            nowIso(),
          ],
        ),
      ),
    ).rejects.toThrow(/foreign key|row-level security|violates/);

    await expect(
      withTenantContext(restrictedPool, tenantA.id, async (client) =>
        client.query(
          `insert into website_ai_proposals (
             id, tenant_id, website_id, section_id, proposal_key, fingerprint,
             proposal_type, title, rationale, expected_gain, risk_summary,
             proposed_title, proposed_body, original_content_hash, status,
             version, generation_version, created_by, created_at, updated_at
           ) values (
             $1, $2, $3, $4, $5, $6, 'seo_copy', $7, $8, $9, $10,
             $11, $12, $13, 'proposed', 1, 'rls-test', $14, $15, $15
           )`,
          [
            id("website_ai_proposal"),
            tenantA.id,
            websiteBId,
            websiteBSectionId,
            `cross-tenant-${randomUUID()}`,
            "a".repeat(64),
            "Proposition étrangère",
            "La relation avec un site étranger doit être refusée.",
            "Aucun gain ne doit être enregistré.",
            "Risque de fuite inter-tenant.",
            "Titre refusé",
            "Contenu refusé par le contrôle tenant.",
            "b".repeat(64),
            ownerA.id,
            nowIso(),
          ],
        ),
      ),
    ).rejects.toThrow(/Cross-tenant relation|Related tenant row|row-level security|violates/);
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

  it("isolates Sales AI assessments and their opportunity relations", async () => {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for this test.");
    }
    const ownerPool = new Pool({ connectionString: databaseUrl });
    ownerPools.push(ownerPool);
    const ownerDb = pgPoolAsSqlClient(ownerPool);
    await migrate(ownerDb, { enableRls: true });
    const services = createServices(ownerDb);
    const ownerA = await services.registerUser({
      name: "Sales RLS Owner A",
      email: uniqueEmail("sales-rls-a"),
      password: "Password!1",
    });
    const ownerB = await services.registerUser({
      name: "Sales RLS Owner B",
      email: uniqueEmail("sales-rls-b"),
      password: "Password!1",
    });
    const tenantA = await services.createTenant(ownerA.id, {
      name: `Sales RLS A ${randomUUID()}`,
      category: "Garage automobile",
    });
    const tenantB = await services.createTenant(ownerB.id, {
      name: `Sales RLS B ${randomUUID()}`,
      category: "Garage automobile",
    });
    for (const [owner, tenant, label] of [
      [ownerA, tenantA, "a"],
      [ownerB, tenantB, "b"],
    ] as const) {
      await services.saveOnboarding(owner.id, tenant.id, defaultGarageOnboarding());
      await services.publishWebsite(owner.id, tenant.id);
      await services.submitPublicLead(tenant.slug, {
        name: `Sales RLS ${label}`,
        email: uniqueEmail(`sales-rls-lead-${label}`),
        phone: "+596 696 40 50 60",
        message: "Demande commerciale tenant-scoped.",
      });
    }
    const salesA = await services.generateSalesAiAssessments(ownerA.id, tenantA.id);
    const salesB = await services.generateSalesAiAssessments(ownerB.id, tenantB.id);
    const assessmentA = salesA.createdIds[0];
    const assessmentB = salesB.createdIds[0];
    const opportunityB = await ownerDb.query<{ id: string }>(
      "select id from opportunities where tenant_id = $1 limit 1",
      [tenantB.id],
    );
    if (!assessmentA || !assessmentB || !opportunityB.rows[0]) {
      throw new Error("Sales AI RLS fixtures are incomplete.");
    }

    const restricted = await createRestrictedRole(ownerPool);
    restrictedRoles.push({ ownerPool, roleName: restricted.roleName });
    const restrictedPool = new Pool({ connectionString: restricted.databaseUrl });
    restrictedPools.push(restrictedPool);
    expect(
      (await restrictedPool.query("select id from sales_ai_assessments")).rows,
    ).toEqual([]);

    const tenantAView = await withTenantContext(
      restrictedPool,
      tenantA.id,
      async (client) => ({
        assessments: (
          await client.query<{ id: string; tenant_id: string }>(
            "select id, tenant_id from sales_ai_assessments order by id",
          )
        ).rows,
        evidence: (
          await client.query<{ assessment_id: string; tenant_id: string }>(
            "select assessment_id, tenant_id from sales_ai_evidence order by id",
          )
        ).rows,
      }),
    );
    expect(tenantAView.assessments).toEqual([
      { id: assessmentA, tenant_id: tenantA.id },
    ]);
    expect(tenantAView.evidence).toHaveLength(6);
    expect(
      tenantAView.evidence.every(
        (row) => row.assessment_id === assessmentA && row.tenant_id === tenantA.id,
      ),
    ).toBe(true);

    await expect(
      withTenantContext(restrictedPool, tenantA.id, (client) =>
        client.query(
          `insert into sales_ai_evidence (
             id, tenant_id, assessment_id, evidence_type, evidence_ref, label,
             observed_value, captured_at, created_at
           ) values ($1, $2, $3, 'follow_up', $4, $5, $6, $7, $7)`,
          [
            id("sales_ai_evidence"),
            tenantA.id,
            assessmentB,
            "cross-tenant",
            "Preuve etrangere",
            "refusee",
            nowIso(),
          ],
        ),
      ),
    ).rejects.toThrow(/foreign key|row-level security|violates/);

    await expect(
      withTenantContext(restrictedPool, tenantA.id, (client) =>
        client.query(
          `insert into sales_ai_assessments (
             id, tenant_id, opportunity_id, fingerprint, status, score,
             closing_estimate, confidence, priority, title, rationale,
             recommended_action, risk_summary, action_label, action_href,
             version, generation_version, generated_by, created_at, updated_at
           ) values (
             $1, $2, $3, $4, 'current', 50, 40, 80, 'medium', $5, $6,
             $7, $8, $9, $10, 1, 'rls-test', $11, $12, $12
           )`,
          [
            id("sales_ai_assessment"),
            tenantA.id,
            opportunityB.rows[0]!.id,
            "c".repeat(64),
            "Evaluation etrangere",
            "La relation avec une opportunite etrangere doit etre refusee.",
            "Ne creer aucune action.",
            "Risque de fuite inter-tenant.",
            "Ouvrir",
            "/opportunites/refusee",
            ownerA.id,
            nowIso(),
          ],
        ),
      ),
    ).rejects.toThrow(/foreign key|row-level security|violates/);

    const hiddenWrites = await withTenantContext(
      restrictedPool,
      tenantA.id,
      async (client) => ({
        updated: (
          await client.query(
            "update sales_ai_assessments set score = 1 where id = $1",
            [assessmentB],
          )
        ).rowCount,
        deleted: (
          await client.query("delete from sales_ai_assessments where id = $1", [
            assessmentB,
          ])
        ).rowCount,
      }),
    );
    expect(hiddenWrites).toEqual({ updated: 0, deleted: 0 });
  });

  it("isolates Reputation AI reviews, proposals, evidence and decisions", async () => {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for this test.");
    }
    const ownerPool = new Pool({ connectionString: databaseUrl });
    ownerPools.push(ownerPool);
    const ownerDb = pgPoolAsSqlClient(ownerPool);
    await migrate(ownerDb, { enableRls: true });
    const services = createServices(ownerDb);
    const ownerA = await services.registerUser({
      name: "Reputation RLS Owner A",
      email: uniqueEmail("reputation-rls-a"),
      password: "Password!1",
    });
    const ownerB = await services.registerUser({
      name: "Reputation RLS Owner B",
      email: uniqueEmail("reputation-rls-b"),
      password: "Password!1",
    });
    const tenantA = await services.createTenant(ownerA.id, {
      name: `Reputation RLS A ${randomUUID()}`,
      category: "Garage automobile",
    });
    const tenantB = await services.createTenant(ownerB.id, {
      name: `Reputation RLS B ${randomUUID()}`,
      category: "Garage automobile",
    });
    const reviewA = await services.createReputationReview(ownerA.id, tenantA.id, {
      source: "manual_import",
      rating: 1,
      reviewText: "Retard important et attente trop longue pour le tenant A.",
      occurredAt: "2026-07-14T08:00:00.000Z",
    });
    const reviewB = await services.createReputationReview(ownerB.id, tenantB.id, {
      source: "direct_feedback",
      rating: 5,
      reviewText: "Excellent accueil pour le tenant B.",
      occurredAt: "2026-07-14T09:00:00.000Z",
    });
    const generatedA = await services.generateReputationProposals(ownerA.id, tenantA.id);
    const generatedB = await services.generateReputationProposals(ownerB.id, tenantB.id);
    const proposalA = generatedA.createdIds[0];
    const proposalB = generatedB.createdIds[0];
    if (!proposalA || !proposalB) {
      throw new Error("Reputation AI RLS fixtures are incomplete.");
    }
    await services.submitReputationProposalForApproval(ownerA.id, tenantA.id, {
      proposalId: proposalA,
    });
    await services.decideReputationProposal(ownerA.id, tenantA.id, {
      proposalId: proposalA,
      decision: "approved",
      reason: "Validation tenant A sans publication.",
    });
    await services.submitReputationProposalForApproval(ownerB.id, tenantB.id, {
      proposalId: proposalB,
    });
    await services.decideReputationProposal(ownerB.id, tenantB.id, {
      proposalId: proposalB,
      decision: "rejected",
      reason: "Rejet tenant B sans publication.",
    });

    const restricted = await createRestrictedRole(ownerPool);
    restrictedRoles.push({ ownerPool, roleName: restricted.roleName });
    const restrictedPool = new Pool({ connectionString: restricted.databaseUrl });
    restrictedPools.push(restrictedPool);
    for (const table of [
      "reputation_reviews",
      "reputation_response_proposals",
      "reputation_proposal_evidence",
      "reputation_proposal_decisions",
    ]) {
      expect((await restrictedPool.query(`select id from ${table}`)).rows).toEqual([]);
    }

    const tenantAView = await withTenantContext(
      restrictedPool,
      tenantA.id,
      async (client) => ({
        reviews: (
          await client.query<{ id: string; tenant_id: string }>(
            "select id, tenant_id from reputation_reviews order by id",
          )
        ).rows,
        proposals: (
          await client.query<{ id: string; tenant_id: string }>(
            "select id, tenant_id from reputation_response_proposals order by id",
          )
        ).rows,
        evidence: (
          await client.query<{ proposal_id: string; tenant_id: string }>(
            "select proposal_id, tenant_id from reputation_proposal_evidence order by id",
          )
        ).rows,
        decisions: (
          await client.query<{ proposal_id: string; tenant_id: string }>(
            "select proposal_id, tenant_id from reputation_proposal_decisions order by id",
          )
        ).rows,
      }),
    );
    expect(tenantAView.reviews).toEqual([{ id: reviewA.reviewId, tenant_id: tenantA.id }]);
    expect(tenantAView.proposals).toEqual([{ id: proposalA, tenant_id: tenantA.id }]);
    expect(tenantAView.evidence).toHaveLength(3);
    expect(tenantAView.evidence.every((row) => row.proposal_id === proposalA)).toBe(true);
    expect(tenantAView.decisions).toEqual([
      { proposal_id: proposalA, tenant_id: tenantA.id },
    ]);

    await expect(
      withTenantContext(restrictedPool, tenantA.id, (client) =>
        client.query(
          `insert into reputation_reviews (
             id, tenant_id, source, rating, review_text, content_hash,
             occurred_at, imported_by, created_at
           ) values ($1, $2, 'manual_import', 3, $3, $4, $5, $6, $5)`,
          [
            id("reputation_review"),
            tenantB.id,
            "Avis injecté dans un autre tenant.",
            "a".repeat(64),
            nowIso(),
            ownerA.id,
          ],
        ),
      ),
    ).rejects.toThrow(/row-level security|violates/);
    await expect(
      withTenantContext(restrictedPool, tenantA.id, (client) =>
        client.query(
          `insert into reputation_response_proposals (
             id, tenant_id, review_id, fingerprint, sentiment, confidence,
             risk_level, authenticity_status, rationale, response_draft,
             improvement_plan, status, version, generation_version,
             generated_by, created_at, updated_at
           ) values (
             $1, $2, $3, $4, 'neutral', 60, 'low', 'not_assessed', $5,
             $6, $7, 'proposed', 1, 'rls-test', $8, $9, $9
           )`,
          [
            id("reputation_proposal"),
            tenantA.id,
            reviewB.reviewId,
            "b".repeat(64),
            "La relation avec un avis étranger doit être refusée.",
            "Réponse non publiable.",
            "Plan interne non exécutable.",
            ownerA.id,
            nowIso(),
          ],
        ),
      ),
    ).rejects.toThrow(/foreign key|row-level security|violates/);
    await expect(
      withTenantContext(restrictedPool, tenantA.id, (client) =>
        client.query(
          `insert into reputation_proposal_evidence (
             id, tenant_id, proposal_id, evidence_type, evidence_ref,
             label, observed_value, captured_at, created_at
           ) values ($1, $2, $3, 'review_source', $4, $5, $6, $7, $7)`,
          [
            id("reputation_evidence"),
            tenantA.id,
            proposalB,
            "cross-tenant",
            "Preuve étrangère",
            "refusée",
            nowIso(),
          ],
        ),
      ),
    ).rejects.toThrow(/foreign key|row-level security|violates/);
    await expect(
      withTenantContext(restrictedPool, tenantA.id, (client) =>
        client.query(
          `insert into reputation_proposal_decisions (
             id, tenant_id, proposal_id, decision, reason, decided_by, created_at
           ) values ($1, $2, $3, 'rejected', $4, $5, $6)`,
          [
            id("reputation_decision"),
            tenantA.id,
            proposalB,
            "Décision inter-tenant refusée.",
            ownerA.id,
            nowIso(),
          ],
        ),
      ),
    ).rejects.toThrow(/foreign key|row-level security|violates/);

    const hiddenWrites = await withTenantContext(
      restrictedPool,
      tenantA.id,
      async (client) => ({
        updated: (
          await client.query(
            "update reputation_reviews set reviewer_alias = 'interdit' where id = $1",
            [reviewB.reviewId],
          )
        ).rowCount,
        deleted: (
          await client.query(
            "delete from reputation_response_proposals where id = $1",
            [proposalB],
          )
        ).rowCount,
      }),
    );
    expect(hiddenWrites).toEqual({ updated: 0, deleted: 0 });
  });

  it("isolates competitor observations, insights, evidence and decisions", async () => {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for this test.");
    }
    const ownerPool = new Pool({ connectionString: databaseUrl });
    ownerPools.push(ownerPool);
    const ownerDb = pgPoolAsSqlClient(ownerPool);
    await migrate(ownerDb, { enableRls: true });
    const services = createServices(ownerDb);
    const ownerA = await services.registerUser({
      name: "Competitor RLS Owner A",
      email: uniqueEmail("competitor-rls-a"),
      password: "Password!1",
    });
    const ownerB = await services.registerUser({
      name: "Competitor RLS Owner B",
      email: uniqueEmail("competitor-rls-b"),
      password: "Password!1",
    });
    const tenantA = await services.createTenant(ownerA.id, {
      name: `Competitor RLS A ${randomUUID()}`,
      category: "Garage automobile",
    });
    const tenantB = await services.createTenant(ownerB.id, {
      name: `Competitor RLS B ${randomUUID()}`,
      category: "Garage automobile",
    });
    const profileA = await services.createCompetitorProfile(ownerA.id, tenantA.id, {
      name: `Concurrent A ${randomUUID()}`,
    });
    const profileB = await services.createCompetitorProfile(ownerB.id, tenantB.id, {
      name: `Concurrent B ${randomUUID()}`,
    });
    const observationA = await services.createCompetitorObservation(ownerA.id, tenantA.id, {
      competitorId: profileA.competitorId,
      category: "price",
      direction: "increase",
      sourceType: "official_website",
      sourceUrl: "https://competitor-a.example.org/pricing",
      title: "Prix public A",
      summary: "Une page publique affiche une évolution de prix pour A.",
      observedAt: "2026-07-14T08:00:00.000Z",
      publicSourceConfirmed: true,
      protectedContentExcluded: true,
    });
    const observationB = await services.createCompetitorObservation(ownerB.id, tenantB.id, {
      competitorId: profileB.competitorId,
      category: "service",
      direction: "new",
      sourceType: "public_announcement",
      sourceUrl: "https://competitor-b.example.org/service",
      title: "Service public B",
      summary: "Une annonce publique présente un nouveau service pour B.",
      observedAt: "2026-07-14T09:00:00.000Z",
      publicSourceConfirmed: true,
      protectedContentExcluded: true,
    });
    const generatedA = await services.generateCompetitorInsights(ownerA.id, tenantA.id);
    const generatedB = await services.generateCompetitorInsights(ownerB.id, tenantB.id);
    const insightA = generatedA.createdIds[0];
    const insightB = generatedB.createdIds[0];
    if (!insightA || !insightB) {
      throw new Error("Competitor Intelligence RLS fixtures are incomplete.");
    }
    await services.submitCompetitorInsightForApproval(ownerA.id, tenantA.id, {
      insightId: insightA,
    });
    await services.decideCompetitorInsight(ownerA.id, tenantA.id, {
      insightId: insightA,
      decision: "approved",
      reason: "Décision de planification tenant A.",
    });
    await services.submitCompetitorInsightForApproval(ownerB.id, tenantB.id, {
      insightId: insightB,
    });
    await services.decideCompetitorInsight(ownerB.id, tenantB.id, {
      insightId: insightB,
      decision: "rejected",
      reason: "Décision de planification tenant B.",
    });

    const restricted = await createRestrictedRole(ownerPool);
    restrictedRoles.push({ ownerPool, roleName: restricted.roleName });
    const restrictedPool = new Pool({ connectionString: restricted.databaseUrl });
    restrictedPools.push(restrictedPool);
    for (const table of [
      "competitor_profiles",
      "competitor_observations",
      "competitor_insights",
      "competitor_insight_evidence",
      "competitor_insight_decisions",
    ]) {
      expect((await restrictedPool.query(`select id from ${table}`)).rows).toEqual([]);
    }

    const tenantAView = await withTenantContext(
      restrictedPool,
      tenantA.id,
      async (client) => ({
        profiles: (
          await client.query<{ id: string; tenant_id: string }>(
            "select id, tenant_id from competitor_profiles order by id",
          )
        ).rows,
        observations: (
          await client.query<{ id: string; tenant_id: string }>(
            "select id, tenant_id from competitor_observations order by id",
          )
        ).rows,
        insights: (
          await client.query<{ id: string; tenant_id: string }>(
            "select id, tenant_id from competitor_insights order by id",
          )
        ).rows,
        evidence: (
          await client.query<{ insight_id: string; tenant_id: string }>(
            "select insight_id, tenant_id from competitor_insight_evidence order by id",
          )
        ).rows,
        decisions: (
          await client.query<{ insight_id: string; tenant_id: string }>(
            "select insight_id, tenant_id from competitor_insight_decisions order by id",
          )
        ).rows,
      }),
    );
    expect(tenantAView.profiles).toEqual([
      { id: profileA.competitorId, tenant_id: tenantA.id },
    ]);
    expect(tenantAView.observations).toEqual([
      { id: observationA.observationId, tenant_id: tenantA.id },
    ]);
    expect(tenantAView.insights).toEqual([{ id: insightA, tenant_id: tenantA.id }]);
    expect(tenantAView.evidence).toEqual([
      { insight_id: insightA, tenant_id: tenantA.id },
    ]);
    expect(tenantAView.decisions).toEqual([
      { insight_id: insightA, tenant_id: tenantA.id },
    ]);

    await expect(
      withTenantContext(restrictedPool, tenantA.id, (client) =>
        client.query(
          `insert into competitor_observations (
             id, tenant_id, competitor_id, category, direction, source_type,
             source_url, title, summary, content_hash, observed_at,
             recorded_by, created_at
           ) values (
             $1, $2, $3, 'price', 'changed', 'official_website',
             $4, $5, $6, $7, $8, $9, $8
           )`,
          [
            id("competitor_observation"),
            tenantA.id,
            profileB.competitorId,
            "https://cross.example.org/",
            "Observation étrangère",
            "Cette relation concurrente étrangère doit être refusée.",
            "c".repeat(64),
            nowIso(),
            ownerA.id,
          ],
        ),
      ),
    ).rejects.toThrow(/foreign key|row-level security|violates/);
    await expect(
      withTenantContext(restrictedPool, tenantA.id, (client) =>
        client.query(
          `insert into competitor_insights (
             id, tenant_id, competitor_id, category, latest_observation_id,
             fingerprint, impact, confidence, title, rationale,
             recommended_action, status, version, generation_version,
             generated_by, created_at, updated_at
           ) values (
             $1, $2, $3, 'service', $4, $5, 'watch', 70, $6, $7,
             $8, 'proposed', 1, 'rls-test', $9, $10, $10
           )`,
          [
            id("competitor_insight"),
            tenantA.id,
            profileA.competitorId,
            observationB.observationId,
            "d".repeat(64),
            "Analyse étrangère",
            "La relation avec une observation étrangère doit être refusée.",
            "Ne déclencher aucune action externe à partir de cette ligne.",
            ownerA.id,
            nowIso(),
          ],
        ),
      ),
    ).rejects.toThrow(/foreign key|row-level security|violates/);
    await expect(
      withTenantContext(restrictedPool, tenantA.id, (client) =>
        client.query(
          `insert into competitor_insight_evidence (
             id, tenant_id, insight_id, observation_id, label,
             observed_value, captured_at, created_at
           ) values ($1, $2, $3, $4, $5, $6, $7, $7)`,
          [
            id("competitor_evidence"),
            tenantA.id,
            insightB,
            observationA.observationId,
            "Preuve étrangère",
            "refusée",
            nowIso(),
          ],
        ),
      ),
    ).rejects.toThrow(/foreign key|row-level security|violates/);
    await expect(
      withTenantContext(restrictedPool, tenantA.id, (client) =>
        client.query(
          `insert into competitor_insight_decisions (
             id, tenant_id, insight_id, decision, reason, decided_by, created_at
           ) values ($1, $2, $3, 'rejected', $4, $5, $6)`,
          [
            id("competitor_decision"),
            tenantA.id,
            insightB,
            "Décision inter-tenant refusée.",
            ownerA.id,
            nowIso(),
          ],
        ),
      ),
    ).rejects.toThrow(/foreign key|row-level security|violates/);

    const hiddenWrites = await withTenantContext(
      restrictedPool,
      tenantA.id,
      async (client) => ({
        updated: (
          await client.query(
            "update competitor_profiles set name = 'interdit' where id = $1",
            [profileB.competitorId],
          )
        ).rowCount,
        deleted: (
          await client.query("delete from competitor_observations where id = $1", [
            observationB.observationId,
          ])
        ).rowCount,
      }),
    );
    expect(hiddenWrites).toEqual({ updated: 0, deleted: 0 });
  });

  it("isolates Financial AI reads, writes and relations by tenant", async () => {
    if (!databaseUrl) {
      throw new Error("DATABASE_URL is required for this test.");
    }
    const ownerPool = new Pool({ connectionString: databaseUrl });
    ownerPools.push(ownerPool);
    const ownerDb = pgPoolAsSqlClient(ownerPool);
    await migrate(ownerDb, { enableRls: true });
    const services = createServices(ownerDb);
    const ownerA = await services.registerUser({
      name: "Financial RLS A",
      email: uniqueEmail("financial-rls-a"),
      password: "Password!1",
    });
    const ownerB = await services.registerUser({
      name: "Financial RLS B",
      email: uniqueEmail("financial-rls-b"),
      password: "Password!1",
    });
    const tenantA = await services.createTenant(ownerA.id, {
      name: `Financial tenant A ${randomUUID()}`,
      category: "Garage automobile",
    });
    const tenantB = await services.createTenant(ownerB.id, {
      name: `Financial tenant B ${randomUUID()}`,
      category: "Garage automobile",
    });
    const financialInput = {
      period: "2026-07",
      monthlyRevenueCents: 1_000_000,
      operatingCostsCents: 800_000,
      cashBalanceCents: 500_000,
      cashInflowsCents: 1_000_000,
      cashOutflowsCents: 900_000,
      receivablesCents: 100_000,
      payablesCents: 80_000,
      marketingSpendCents: 0,
      salesSpendCents: 0,
      websiteSpendCents: 0,
      automationSpendCents: 0,
      newCustomers: 0,
      activeCustomers: 0,
      evidenceSummary: "Données de test validées pour la politique RLS.",
    };
    const snapshotA = await services.recordFinancialInputSnapshot(
      ownerA.id,
      tenantA.id,
      financialInput,
    );
    const snapshotB = await services.recordFinancialInputSnapshot(
      ownerB.id,
      tenantB.id,
      financialInput,
    );
    const assessmentA = await services.generateFinancialAssessment(
      ownerA.id,
      tenantA.id,
    );
    const assessmentB = await services.generateFinancialAssessment(
      ownerB.id,
      tenantB.id,
    );
    const employeeA = (await services.getAiEmployeeWorkspace(ownerA.id, tenantA.id))
      .employees[0];
    const employeeB = (await services.getAiEmployeeWorkspace(ownerB.id, tenantB.id))
      .employees[0];
    if (!employeeA || !employeeB) {
      throw new Error("AI Employee RLS fixtures are incomplete.");
    }

    const restricted = await createRestrictedRole(ownerPool);
    restrictedRoles.push({ ownerPool, roleName: restricted.roleName });
    const restrictedPool = new Pool({ connectionString: restricted.databaseUrl });
    restrictedPools.push(restrictedPool);
    for (const table of [
      "financial_input_snapshots",
      "financial_assessments",
      "financial_assessment_evidence",
      "financial_alerts",
      "ai_employee_profiles",
      "ai_employee_activity_logs",
    ]) {
      expect((await restrictedPool.query(`select id from ${table}`)).rows).toEqual([]);
    }

    const tenantAView = await withTenantContext(
      restrictedPool,
      tenantA.id,
      async (client) => ({
        snapshots: (
          await client.query<{ id: string; tenant_id: string }>(
            "select id, tenant_id from financial_input_snapshots order by id",
          )
        ).rows,
        assessments: (
          await client.query<{ id: string; tenant_id: string }>(
            "select id, tenant_id from financial_assessments order by id",
          )
        ).rows,
        evidenceTenants: (
          await client.query<{ tenant_id: string }>(
            "select distinct tenant_id from financial_assessment_evidence",
          )
        ).rows,
        alertTenants: (
          await client.query<{ tenant_id: string }>(
            "select distinct tenant_id from financial_alerts",
          )
        ).rows,
        employeeProfiles: (
          await client.query<{ tenant_id: string }>(
            "select distinct tenant_id from ai_employee_profiles",
          )
        ).rows,
        employeeActivities: (
          await client.query<{ tenant_id: string }>(
            "select distinct tenant_id from ai_employee_activity_logs",
          )
        ).rows,
      }),
    );
    expect(tenantAView.snapshots).toEqual([
      { id: snapshotA.snapshotId, tenant_id: tenantA.id },
    ]);
    expect(tenantAView.assessments).toEqual([
      { id: assessmentA.assessmentId, tenant_id: tenantA.id },
    ]);
    expect(tenantAView.evidenceTenants).toEqual([{ tenant_id: tenantA.id }]);
    expect(tenantAView.alertTenants).toEqual([]);
    expect(tenantAView.employeeProfiles).toEqual([{ tenant_id: tenantA.id }]);
    expect(tenantAView.employeeActivities).toEqual([{ tenant_id: tenantA.id }]);

    await expect(
      withTenantContext(restrictedPool, tenantA.id, (client) =>
        client.query(
          `insert into financial_assessment_evidence (
             id, tenant_id, assessment_id, evidence_type, source_ref,
             label, observed_value, captured_at, created_at
           ) values ($1, $2, $3, 'formula', $4, $5, $6, $7, $7)`,
          [
            id("financial_evidence"),
            tenantA.id,
            assessmentB.assessmentId,
            "rls-test",
            "Preuve inter-tenant",
            "Cette preuve doit être refusée.",
            nowIso(),
          ],
        ),
      ),
    ).rejects.toThrow(/foreign key|row-level security|violates/);
    await expect(
      withTenantContext(restrictedPool, tenantA.id, (client) =>
        client.query(
          `insert into financial_assessments (
             id, tenant_id, snapshot_id, period_month, fingerprint, status,
             version, monthly_revenue_cents, estimated_profit_cents,
             cash_flow_cents, pipeline_value_cents, weighted_pipeline_value_cents,
             forecast_three_months_cents, confidence, rationale, limitations,
             recommended_action, generation_version, generated_by,
             created_at, updated_at
           ) values (
             $1, $2, $3, '2026-08', $4, 'current', 1, 0, 0, 0, 0, 0, 0,
             50, $5, $6, $7, 'rls-test', $8, $9, $9
           )`,
          [
            id("financial_assessment"),
            tenantA.id,
            snapshotB.snapshotId,
            "f".repeat(64),
            "Une relation inter-tenant doit être refusée par PostgreSQL.",
            "Aucune donnée comptable ne doit être déduite de cette tentative.",
            "Ne déclencher aucune action à partir de cette tentative.",
            ownerA.id,
            nowIso(),
          ],
        ),
      ),
    ).rejects.toThrow(/foreign key|row-level security|violates/);
    await expect(
      withTenantContext(restrictedPool, tenantA.id, (client) =>
        client.query(
          `insert into ai_employee_activity_logs (
             id, tenant_id, employee_key, profile_id, activity_type,
             summary, safe_metadata, actor_id, created_at
           ) values ($1, $2, $3, $4, 'profile_revised', $5, $6, $7, $8)`,
          [
            id("ai_employee_activity"),
            tenantA.id,
            employeeA.employeeKey,
            employeeB.id,
            "Cette activité inter-tenant doit être refusée.",
            toJson({ externalExecutionEnabled: false }),
            ownerA.id,
            nowIso(),
          ],
        ),
      ),
    ).rejects.toThrow(/foreign key|row-level security|violates/);

    const hiddenWrites = await withTenantContext(
      restrictedPool,
      tenantA.id,
      async (client) => ({
        updated: (
          await client.query(
            "update financial_input_snapshots set evidence_summary = 'interdit' where id = $1",
            [snapshotB.snapshotId],
          )
        ).rowCount,
        deleted: (
          await client.query("delete from financial_assessments where id = $1", [
            assessmentB.assessmentId,
          ])
        ).rowCount,
        employeeUpdated: (
          await client.query(
            "update ai_employee_profiles set display_name = 'interdit' where id = $1",
            [employeeB.id],
          )
        ).rowCount,
        activityDeleted: (
          await client.query(
            "delete from ai_employee_activity_logs where profile_id = $1",
            [employeeB.id],
          )
        ).rowCount,
      }),
    );
    expect(hiddenWrites).toEqual({
      updated: 0,
      deleted: 0,
      employeeUpdated: 0,
      activityDeleted: 0,
    });
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
