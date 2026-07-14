import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { Pool } from "pg";
import { pgPoolAsSqlClient } from "../src/db/client";
import { migrate } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import { getDashboardData } from "../src/modules/dashboard";
import { setPlatformRole } from "../src/modules/platform-admin";

const databaseUrl = process.env.DATABASE_URL;
const describeIfPostgres = databaseUrl ? describe : describe.skip;
const cleanupTasks: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanupTasks.splice(0).reverse()) {
    await cleanup();
  }
});

describeIfPostgres("bounded PostgreSQL scale", () => {
  it(
    "keeps command-center totals exact and lists bounded at target volumes",
    async () => {
      if (!databaseUrl) throw new Error("DATABASE_URL is required.");
      const databaseName = `tradikom_scale_${randomUUID().replaceAll("-", "")}`;
      const adminPool = new Pool({ connectionString: databaseUrl });
      await adminPool.query(`create database ${databaseName}`);
      const targetUrl = new URL(databaseUrl);
      targetUrl.pathname = `/${databaseName}`;
      const pool = new Pool({ connectionString: targetUrl.toString() });
      cleanupTasks.push(async () => {
        await pool.end();
        await waitForDatabaseConnectionsToClose(adminPool, databaseName);
        await adminPool.query(`drop database if exists ${databaseName}`);
        await adminPool.end();
      });

      const db = pgPoolAsSqlClient(pool);
      await migrate(db, { enableRls: true });
      const services = createServices(db);
      const owner = await services.registerUser({
        name: "Scale Owner",
        email: "scale-owner@example.com",
        password: "Password!1",
      });
      const tenant = await services.createTenant(owner.id, {
        name: "Scale Tenant",
        category: "Services",
      });
      await setPlatformRole(db, owner.id, "platform_admin");
      const software = await services.createSoftwareDirectoryEntry(
        owner.id,
        tenant.id,
        {
          canonicalName: "Scale Software",
          aliases: [],
          vendor: "Scale Vendor",
          officialDomain: "scale.example.test",
          supportedRegions: [],
          languages: ["fr"],
          industries: ["Services"],
          categories: ["Test"],
          officialWebsite: "https://scale.example.test/",
        },
      );
      await services.decideSoftwareDomain(owner.id, tenant.id, {
        domainId: software.domainId,
        status: "approved",
        reason: "Domaine de charge approuve explicitement pour le test.",
      });
      const product = await services.createApiProductRecord(
        owner.id,
        tenant.id,
        {
          softwareId: software.softwareId,
          name: "Scale API",
          apiStyle: "rest",
          version: "1",
          documentationUrl: "https://scale.example.test/api",
        },
      );
      const stage = await db.query<{ id: string }>(
        "select id from pipeline_stages where tenant_id = $1 order by position asc limit 1",
        [tenant.id],
      );
      const stageId = stage.rows[0]?.id;
      if (!stageId) throw new Error("Pipeline stage missing.");

      await db.query(
        `insert into contacts (
           id, tenant_id, name, email, phone, status, source, tags,
           assigned_user_id, created_at, updated_at
         )
         select $1 || '-contact-' || value, $2, 'Contact ' || value,
           'contact-' || value || '@scale.test', '+596' || lpad(value::text, 9, '0'),
           'active', 'scale', '[]', null, $3, $3
         from generate_series(1, 10000) as value`,
        [databaseName, tenant.id, "2026-07-13T12:00:00.000Z"],
      );
      await db.query(
        `insert into opportunities (
           id, tenant_id, contact_id, stage_id, value_cents,
           next_follow_up_at, lost_reason, created_at, updated_at
         )
         select $1 || '-opportunity-' || value, $2,
           $1 || '-contact-' || value, $3, 10000 + value,
           '2026-07-13T10:00:00.000Z', null, $4, $4
         from generate_series(1, 1000) as value`,
        [databaseName, tenant.id, stageId, "2026-07-13T12:00:00.000Z"],
      );
      await db.query(
        `insert into workflows (
           id, tenant_id, workflow_key, name, trigger_name, status,
           approval_policy, definition, created_at
         )
         select $1 || '-workflow-' || value, $2, $1 || '-key-' || value,
           'Workflow ' || value, 'scale.event', 'active', 'none', '{}', $3
         from generate_series(1, 99) as value`,
        [databaseName, tenant.id, "2026-07-13T12:00:00.000Z"],
      );
      await db.query(
        `insert into domain_events (
           id, tenant_id, actor_id, event_type, payload, status, attempts,
           idempotency_key, correlation_id, next_run_at, last_error,
           created_at, updated_at
         )
         select $1 || '-event-' || value, $2, $3, 'scale.event', '{}',
           case when value <= 100 then 'failed' else 'pending' end,
           case when value <= 100 then 8 else 0 end,
           $1 || '-idempotency-' || value, $1 || '-correlation-' || value,
           $4, case when value <= 100 then 'safe_failure' else null end, $4, $4
         from generate_series(1, 10000) as value`,
        [databaseName, tenant.id, owner.id, "2026-07-13T12:00:00.000Z"],
      );
      await db.query(
        `insert into api_sources (
           id, software_id, api_product_id, canonical_url, source_type,
           source_classification, publisher_domain, created_by, created_at
         )
         select $1 || '-source-' || value, $2, $3,
           'https://scale.example.test/source/' || value,
           'official_openapi_specification', 'official',
           'scale.example.test', $4, $5
         from generate_series(1, 1000) as value`,
        [
          databaseName,
          software.softwareId,
          product.apiProductId,
          owner.id,
          "2026-07-13T12:00:00.000Z",
        ],
      );
      await db.query(
        `insert into api_source_snapshots (
           id, source_id, retrieved_at, http_status, content_hash,
           parser_version, robots_decision, access_policy_decision,
           content_type, content, safe_metadata, created_at
         )
         select $1 || '-snapshot-' || source_value || '-' || version_value,
           $1 || '-source-' || source_value, $2, 200,
           md5($1 || '-' || source_value || '-' || version_value),
           'scale-1', 'allowed', 'approved_domain_only',
           'application/json', '{}', '{}', $2
         from generate_series(1, 1000) as source_value
         cross join generate_series(1, 100) as version_value`,
        [databaseName, "2026-07-13T12:00:00.000Z"],
      );
      await db.query(
        `insert into connector_proposals (
           id, tenant_id, software_id, api_product_id, name, version, status,
           enabled, manifest, unresolved_questions, risk_assessment,
           created_by, created_at, updated_at
         )
         select $1 || '-proposal-' || value, $2, $3, $4,
           'Proposal ' || value, '0.1.0', 'security_review_required',
           0, '{}', '[]', '{}', $5, $6, $6
         from generate_series(1, 100) as value`,
        [
          databaseName,
          tenant.id,
          software.softwareId,
          product.apiProductId,
          owner.id,
          "2026-07-13T12:00:00.000Z",
        ],
      );
      await db.query(
        `insert into connector_approval_requests (
           id, tenant_id, connector_proposal_id, requested_scope, status,
           submitted_by, created_at
         )
         select $1 || '-approval-' || value, $2,
           $1 || '-proposal-' || value, 'sandbox', 'pending', $3, $4
         from generate_series(1, 100) as value`,
        [databaseName, tenant.id, owner.id, "2026-07-13T12:00:00.000Z"],
      );

      const dashboard = await getDashboardData(db, owner.id, tenant.id, {
        now: new Date("2026-07-13T16:00:00.000Z"),
        timeZone: "America/Martinique",
        activityLimit: 10,
        workflowLimit: 10,
        itemLimit: 10,
      });
      expect(dashboard.metrics.contacts).toBe(10_000);
      expect(dashboard.metrics.opportunitiesNeedingFollowUp).toBe(1_000);
      expect(dashboard.metrics.deadLetters).toBe(100);
      expect(dashboard.metrics.pendingApprovals).toBe(100);
      expect(dashboard.commandCenter.opportunitiesNeedingFollowUp).toHaveLength(10);
      expect(dashboard.commandCenter.deadLetters).toHaveLength(10);
      expect(dashboard.commandCenter.pendingApprovals).toHaveLength(10);

      const volumes = await db.query<{
        contacts: number;
        opportunities: number;
        workflows: number;
        events: number;
        sources: number;
        snapshots: number;
        proposals: number;
        approvals: number;
      }>(
        `select
           (select count(*)::int from contacts where tenant_id = $1) as contacts,
           (select count(*)::int from opportunities where tenant_id = $1) as opportunities,
           (select count(*)::int from workflows where tenant_id = $1) as workflows,
           (select count(*)::int from domain_events where tenant_id = $1) as events,
           (select count(*)::int from api_sources where api_product_id = $2) as sources,
           (select count(*)::int from api_source_snapshots
             join api_sources on api_sources.id = api_source_snapshots.source_id
             where api_sources.api_product_id = $2) as snapshots,
           (select count(*)::int from connector_proposals where tenant_id = $1) as proposals,
           (select count(*)::int from connector_approval_requests where tenant_id = $1) as approvals`,
        [tenant.id, product.apiProductId],
      );
      expect(volumes.rows[0]).toEqual({
        contacts: 10_000,
        opportunities: 1_000,
        workflows: 100,
        events: 10_000,
        sources: 1_000,
        snapshots: 100_000,
        proposals: 100,
        approvals: 100,
      });
    },
    120_000,
  );
});

async function waitForDatabaseConnectionsToClose(
  adminPool: Pool,
  databaseName: string,
) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const result = await adminPool.query<{ connection_count: string }>(
      `select count(*)::text as connection_count
       from pg_stat_activity
       where datname = $1`,
      [databaseName],
    );
    if (result.rows[0]?.connection_count === "0") return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Temporary database connections did not close.");
}
