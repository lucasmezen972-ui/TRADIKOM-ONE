import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb, type DbClient } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import { runMaintenance } from "../src/modules/maintenance";
import { createDatabaseRateLimiter } from "../src/modules/rate-limit";

const opened: Array<{ close: () => Promise<void> }> = [];
const now = new Date("2026-07-12T16:00:00.000Z");
const old = "2025-01-01T00:00:00.000Z";

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("scheduled maintenance", () => {
  it("cleans retained records without deleting audit or delivery history", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const user = await services.registerUser({
      name: "Maintenance Owner",
      email: "maintenance@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(user.id, {
      name: "Garage Maintenance",
      category: "Garage automobile",
    });
    const auditBefore = await count(db, "audit_logs");

    const expiredSession = await services.createSession(user.id);
    const revokedSession = await services.createSession(user.id);
    await db.query("update sessions set expires_at = $1 where id = $2", [
      old,
      expiredSession.sessionId,
    ]);
    await db.query("update sessions set revoked_at = $1 where id = $2", [
      old,
      revokedSession.sessionId,
    ]);
    await db.query(
      "insert into password_reset_tokens (id, user_id, token_hash, expires_at, used_at) values ($1, $2, $3, $4, $5), ($6, $2, $7, $8, $9)",
      [
        "reset_expired",
        user.id,
        "hash_expired",
        old,
        null,
        "reset_used",
        "hash_used",
        "2030-01-01T00:00:00.000Z",
        old,
      ],
    );

    const invitation = await services.createInvitation(user.id, tenant.id, {
      email: "expired-invite@example.com",
      role: "manager",
    });
    await db.query("update invitations set expires_at = $1 where id = $2", [
      old,
      invitation.id,
    ]);
    await db.query(
      `insert into invitations (
         id, tenant_id, email, role, status, token_hash, expires_at, created_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        "invite_completed_old",
        tenant.id,
        "completed@example.com",
        "read-only",
        "accepted",
        "completed_hash",
        old,
        old,
      ],
    );

    await createDatabaseRateLimiter(db).consume({
      operationKey: "maintenance.test",
      subjectKey: "old-subject",
      limit: 1,
      windowSeconds: 60,
      now: new Date(old),
    });

    const websiteId = "website_maintenance";
    await db.query(
      `insert into websites (
         id, tenant_id, name, template_key, theme, status,
         current_version_id, current_draft_version_id,
         current_published_version_id, published_at, created_at, updated_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)`,
      [
        websiteId,
        tenant.id,
        "Site maintenance",
        "artisan",
        "{}",
        "draft",
        null,
        null,
        null,
        null,
        old,
        old,
      ],
    );
    await db.query(
      `insert into form_submissions (
         id, tenant_id, form_id, website_id, payload, created_contact_id,
         idempotency_key, created_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        "submission_old",
        tenant.id,
        null,
        websiteId,
        "{}",
        null,
        "old-form-key",
        old,
      ],
    );
    const endpoint = await db.query<{ id: string }>(
      "select id from webhook_endpoints where tenant_id = $1 limit 1",
      [tenant.id],
    );
    await db.query(
      `insert into webhook_deliveries (
         id, tenant_id, webhook_endpoint_id, status, idempotency_key,
         payload, error, created_at
       ) values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        "delivery_old",
        tenant.id,
        endpoint.rows[0]?.id,
        "accepted",
        "old-webhook-key",
        "{}",
        null,
        old,
      ],
    );
    await db.query(
      `insert into domain_events (
         id, tenant_id, actor_id, event_type, payload, status, attempts,
         idempotency_key, correlation_id, next_run_at, last_error,
         last_attempted_at, last_retry_delay_ms, failure_classification,
         max_attempts, created_at, updated_at
       ) values
         ('event_completed_old', $1, $2, 'maintenance.completed', '{}',
          'succeeded', 1, 'maintenance-completed', 'maintenance-correlation',
          $3, null, $3, 0, null, 3, $3, $3),
         ('event_failed_old', $1, $2, 'maintenance.failed', '{}',
          'failed', 3, 'maintenance-failed', 'maintenance-correlation-failed',
          $3, 'safe_failure', $3, 1000, 'max_attempts_exceeded', 3, $3, $3)`,
      [tenant.id, user.id, old],
    );
    await db.query(
      `insert into notifications (
         id, tenant_id, channel, recipient_user_id, message, status, created_at
       ) values
         ('notification_sent_old', $1, 'mock_email', $2, 'Message sûr', 'sent', $3),
         ('notification_queued_old', $1, 'mock_email', $2, 'Message en attente', 'queued', $3)`,
      [tenant.id, user.id, old],
    );
    await seedPhase3RetentionFixtures(db, tenant.id, user.id);
    await db.query(
      `insert into export_jobs (
         id, tenant_id, entity_type, format, status, selected_fields,
         date_from, date_to, row_count, safe_content, content_encoding,
         content_type, file_name, expires_at, created_by, created_at,
         updated_at, completed_at
       ) values (
         'export_expired_old', $1, 'contacts', 'csv', 'completed', '["name"]',
         $2, $2, 1, 'Y29udGVudA==', 'base64', 'text/csv', 'expired.csv',
         $2, $3, $2, $2, $2
       )`,
      [tenant.id, old, user.id],
    );

    const summary = await runMaintenance(db, { now, batchSize: 50 });

    expect(summary).toMatchObject({
      expiredSessions: 1,
      revokedSessions: 1,
      expiredResetTokens: 1,
      consumedResetTokens: 1,
      markedExpiredInvitations: 1,
      completedInvitations: 1,
      rateLimitBuckets: 1,
      formSubmissionRecords: 1,
      webhookIdempotencyKeys: 1,
      completedDomainEvents: 1,
      sentNotifications: 1,
      apiSourceSnapshots: 1,
      connectorContractRuns: 1,
      connectorProposals: 1,
      expiredExports: 1,
    });
    expect(await count(db, "audit_logs")).toBe(auditBefore + 1);
    const delivery = await db.query<{ idempotency_key: string | null }>(
      "select idempotency_key from webhook_deliveries where id = $1",
      ["delivery_old"],
    );
    expect(delivery.rows[0]?.idempotency_key).toBeNull();
    expect(await exists(db, "domain_events", "event_completed_old")).toBe(false);
    expect(await exists(db, "domain_events", "event_failed_old")).toBe(true);
    expect(await exists(db, "notifications", "notification_sent_old")).toBe(false);
    expect(await exists(db, "notifications", "notification_queued_old")).toBe(true);
    expect(await exists(db, "api_source_snapshots", "snapshot_unreferenced_old")).toBe(false);
    expect(await exists(db, "api_source_snapshots", "snapshot_protected_old")).toBe(true);
    expect(await exists(db, "connector_contract_runs", "contract_run_old")).toBe(false);
    expect(await exists(db, "connector_contract_runs", "contract_run_current")).toBe(true);
    expect(await exists(db, "connector_proposals", "proposal_superseded_old")).toBe(false);
    const expiredExport = await db.query<{
      status: string;
      safe_content: string | null;
    }>("select status, safe_content from export_jobs where id = $1", [
      "export_expired_old",
    ]);
    expect(expiredExport.rows[0]).toEqual({ status: "expired", safe_content: null });
  });

  it("honors the configured batch bound", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    await db.query(
      `insert into users (id, name, email, password_hash, created_at)
       values ($1, $2, $3, $4, $5)`,
      ["user_batch", "Batch", "batch@example.com", "hash", old],
    );
    for (let index = 0; index < 3; index += 1) {
      await db.query(
        `insert into sessions (
           id, user_id, token_hash, expires_at, revoked_at, created_at
         ) values ($1, $2, $3, $4, $5, $6)`,
        [`session_${index}`, "user_batch", `hash_${index}`, old, null, old],
      );
    }

    const first = await runMaintenance(db, { now, batchSize: 2 });
    const second = await runMaintenance(db, { now, batchSize: 2 });

    expect(first.expiredSessions).toBe(2);
    expect(second.expiredSessions).toBe(1);
  });
});

async function count(
  db: DbClient,
  table: string,
) {
  const result = await db.query<{ count: number | string }>(
    `select count(*) as count from ${table}`,
  );
  return Number(result.rows[0]?.count ?? 0);
}

async function exists(db: DbClient, table: string, id: string) {
  const result = await db.query<{ id: string }>(
    `select id from ${table} where id = $1`,
    [id],
  );
  return result.rows.length > 0;
}

async function seedPhase3RetentionFixtures(
  db: DbClient,
  tenantId: string,
  userId: string,
) {
  await db.query(
    `insert into software_directory_entries (
       id, canonical_name, aliases, vendor, official_domain, country,
       supported_regions, languages, industries, categories,
       official_website, developer_portal, support_page,
       partner_program_page, pricing_information_page, verification_status,
       confidence_score, last_verified_at, evidence_count, created_by,
       created_at, updated_at
     ) values (
       'maintenance_software', 'Maintenance Software', '[]', 'Maintenance',
       'maintenance.example.test', null, '[]', '["fr"]', '[]', '[]',
       'https://maintenance.example.test', null, null, null, null,
       'verified', 100, $1, 1, $2, $1, $1
     )`,
    [old, userId],
  );
  await db.query(
    `insert into api_products (
       id, software_id, name, api_style, version, base_url,
       documentation_url, openapi_url, postman_collection_url,
       graphql_schema_url, authentication_type, oauth_metadata, scopes,
       webhook_support, sandbox_support, partner_access_requirement,
       access_level, rate_limit_information, deprecation_status, terms_url,
       confidence_score, last_verified_at, created_at, updated_at
     ) values (
       'maintenance_api', 'maintenance_software', 'Maintenance API', 'rest',
       '1', 'https://api.maintenance.example.test',
       'https://maintenance.example.test/docs', null, null, null, 'none',
       '{}', '[]', 0, 1, 0, 'public', null, 'active', null, 100, $1, $1, $1
     )`,
    [old],
  );
  await db.query(
    `insert into api_sources (
       id, software_id, api_product_id, canonical_url, source_type,
       source_classification, publisher_domain, created_by, created_at
     ) values (
       'maintenance_source', 'maintenance_software', 'maintenance_api',
       'https://maintenance.example.test/openapi.json',
       'official_openapi_specification', 'official',
       'maintenance.example.test', $1, $2
     )`,
    [userId, old],
  );
  for (const [snapshotId, hash] of [
    ["snapshot_unreferenced_old", "c".repeat(64)],
    ["snapshot_protected_old", "d".repeat(64)],
  ]) {
    await db.query(
      `insert into api_source_snapshots (
         id, source_id, retrieved_at, http_status, etag, last_modified,
         content_hash, parser_version, robots_decision,
         access_policy_decision, content_type, content, safe_metadata,
         created_at
       ) values ($1, 'maintenance_source', $2, 200, null, null, $3,
         'maintenance-test', 'allowed', 'allowed', 'application/json', '{}',
         '{}', $2)`,
      [snapshotId, old, hash],
    );
  }
  await db.query(
    `insert into api_claims (
       id, source_snapshot_id, subject_type, subject_id, claim_type,
       claim_value, confidence, approval_status, created_at
     ) values (
       'maintenance_claim', 'snapshot_protected_old', 'api_product',
       'maintenance_api', 'availability', 'verified', 'high', 'approved', $1
     )`,
    [old],
  );
  for (const [proposalId, status, updatedAt] of [
    ["proposal_active", "static_checks_passed", now.toISOString()],
    ["proposal_superseded_old", "superseded", old],
  ]) {
    await db.query(
      `insert into connector_proposals (
         id, tenant_id, software_id, api_product_id, name, version, status,
         enabled, manifest, unresolved_questions, risk_assessment, created_by,
         created_at, updated_at
       ) values ($1, $2, 'maintenance_software', 'maintenance_api', $3, '0.1.0',
         $4, 0, '{}', '[]', '{}', $5, $6, $7)`,
      [proposalId, tenantId, proposalId, status, userId, old, updatedAt],
    );
  }
  for (const [runId, createdAt] of [
    ["contract_run_old", old],
    ["contract_run_current", now.toISOString()],
  ]) {
    await db.query(
      `insert into connector_contract_runs (
         id, tenant_id, connector_proposal_id, connector_version,
         api_version, test_suite_version, environment, status, results,
         safe_logs, created_at
       ) values ($1, $2, 'proposal_active', '0.1.0', '1', 'maintenance-test',
         'mock', 'passed', '{}', '[]', $3)`,
      [runId, tenantId, createdAt],
    );
  }
}
