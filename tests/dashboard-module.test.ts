import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb, type DbClient } from "../src/lib/db";
import { defaultGarageOnboarding } from "../src/lib/generation";
import { createServices } from "../src/lib/services";
import { getDashboardData } from "../src/modules/dashboard";

const opened: Array<{ close: () => Promise<void> }> = [];
const businessNow = new Date("2026-07-14T16:00:00.000Z");
const dashboardInput = {
  now: businessNow,
  timeZone: "America/Martinique",
  activityLimit: 8,
  workflowLimit: 10,
  itemLimit: 10,
};

afterEach(async () => {
  await Promise.all(opened.splice(0).map((db) => db.close()));
});

describe("dashboard module", () => {
  it("computes every operational metric in the configured business day", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const owner = await services.registerUser({
      name: "Dashboard Owner",
      email: "dashboard-owner@example.com",
      password: "Password!1",
    });
    const tenant = await services.createTenant(owner.id, {
      name: "Dashboard Garage",
      category: "Garage automobile",
    });
    await services.saveOnboarding(owner.id, tenant.id, defaultGarageOnboarding());
    await services.publishWebsite(owner.id, tenant.id);
    await seedOperationalDashboard(db, owner.id, tenant.id);

    const dashboard = await getDashboardData(
      db,
      owner.id,
      tenant.id,
      dashboardInput,
    );

    expect(dashboard.metrics).toEqual({
      newLeads: 1,
      contacts: 2,
      pendingTasks: 2,
      formSubmissions: 1,
      overdueTasks: 1,
      opportunitiesNeedingFollowUp: 1,
      workflowFailures: 1,
      deadLetters: 1,
      connectorIssues: 1,
      apiSourceFailures: 1,
      breakingApiChanges: 1,
      pendingApprovals: 1,
    });
    expect(dashboard.commandCenter).toMatchObject({
      capturedAt: businessNow.toISOString(),
      timeZone: "America/Martinique",
      dayStartedAt: "2026-07-14T04:00:00.000Z",
      dayEndsAt: "2026-07-15T04:00:00.000Z",
    });
    expect(dashboard.commandCenter.newLeads).toHaveLength(1);
    expect(dashboard.commandCenter.overdueTasks).toHaveLength(1);
    expect(dashboard.commandCenter.opportunitiesNeedingFollowUp).toHaveLength(1);
    expect(dashboard.commandCenter.workflowFailures).toHaveLength(1);
    expect(dashboard.commandCenter.deadLetters).toHaveLength(1);
    expect(dashboard.commandCenter.apiSourceFailures).toHaveLength(1);
    expect(dashboard.commandCenter.breakingApiChanges).toHaveLength(1);
    expect(dashboard.commandCenter.pendingApprovals).toHaveLength(1);
    expect(dashboard.detectedOpportunities).toHaveLength(1);
    expect(dashboard.commandCenter.website).toMatchObject({
      status: "published",
      hasUnpublishedChanges: true,
    });
    expect(dashboard.commandCenter.priorityActions[0]?.severity).toBe("critical");
    expect(dashboard.commandCenter.priorityActions.every((item) => item.actionHref.startsWith("/"))).toBe(true);
  });

  it("keeps zero states, approval visibility and all reads tenant-scoped", async () => {
    const db = await createMemoryDb();
    opened.push(db);
    const services = createServices(db);
    const firstOwner = await services.registerUser({
      name: "First Dashboard Owner",
      email: "first-dashboard-owner@example.com",
      password: "Password!1",
    });
    const secondOwner = await services.registerUser({
      name: "Second Dashboard Owner",
      email: "second-dashboard-owner@example.com",
      password: "Password!1",
    });
    const firstTenant = await services.createTenant(firstOwner.id, {
      name: "First Dashboard Garage",
      category: "Garage automobile",
    });
    const secondTenant = await services.createTenant(secondOwner.id, {
      name: "Second Dashboard Garage",
      category: "Garage automobile",
    });
    await db.query(
      "insert into memberships (tenant_id, user_id, role, created_at) values ($1, $2, $3, $4)",
      [firstTenant.id, secondOwner.id, "collaborator", businessNow.toISOString()],
    );
    await db.query(
      `insert into approvals
        (id, tenant_id, requested_by, policy, status, target_type, target_id, created_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        "approval-tenant-one",
        firstTenant.id,
        firstOwner.id,
        "administrator_approval_required",
        "pending",
        "workflow_run",
        "run-missing",
        businessNow.toISOString(),
      ],
    );

    const ownerView = await getDashboardData(
      db,
      firstOwner.id,
      firstTenant.id,
      dashboardInput,
    );
    const collaboratorView = await getDashboardData(
      db,
      secondOwner.id,
      firstTenant.id,
      dashboardInput,
    );
    const cleanTenant = await getDashboardData(
      db,
      secondOwner.id,
      secondTenant.id,
      dashboardInput,
    );

    expect(ownerView.metrics.pendingApprovals).toBe(1);
    expect(ownerView.commandCenter.pendingApprovals).toHaveLength(1);
    expect(collaboratorView.metrics.pendingApprovals).toBe(0);
    expect(collaboratorView.commandCenter.pendingApprovals).toEqual([]);
    expect(cleanTenant.metrics).toMatchObject({
      newLeads: 0,
      contacts: 0,
      pendingTasks: 0,
      formSubmissions: 0,
      overdueTasks: 0,
      opportunitiesNeedingFollowUp: 0,
      workflowFailures: 0,
      deadLetters: 0,
      apiSourceFailures: 0,
      breakingApiChanges: 0,
      pendingApprovals: 0,
    });
    expect(cleanTenant.detectedOpportunities).toEqual([]);
    expect(cleanTenant.commandCenter.newLeads).toEqual([]);
    expect(cleanTenant.commandCenter.overdueTasks).toEqual([]);
    expect(cleanTenant.commandCenter.breakingApiChanges).toEqual([]);
    await expect(
      getDashboardData(db, firstOwner.id, secondTenant.id, dashboardInput),
    ).rejects.toMatchObject({ code: "dashboard_access_denied" });
  });
});

async function seedOperationalDashboard(
  db: DbClient,
  userId: string,
  tenantId: string,
) {
  const stage = await db.query<{ id: string }>(
    "select id from pipeline_stages where tenant_id = $1 order by position asc limit 1",
    [tenantId],
  );
  const website = await db.query<{ id: string }>(
    "select id from websites where tenant_id = $1 limit 1",
    [tenantId],
  );
  const stageId = stage.rows[0]?.id;
  const websiteId = website.rows[0]?.id;
  if (!stageId || !websiteId) {
    throw new Error("Dashboard fixture provisioning failed.");
  }

  for (const contact of [
    ["contact-current", "Lead du jour", "lead-today@example.com", "active"],
    ["contact-previous", "Lead precedent", "lead-previous@example.com", "active"],
    ["contact-archived", "Contact archive", "archived@example.com", "archived"],
  ]) {
    await db.query(
      `insert into contacts
        (id, tenant_id, name, email, phone, status, source, tags, assigned_user_id, created_at, updated_at)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)`,
      [
        contact[0],
        tenantId,
        contact[1],
        contact[2],
        "0696000000",
        contact[3],
        "test",
        "[]",
        userId,
        "2026-07-14T05:00:00.000Z",
      ],
    );
  }
  await db.query(
    `insert into leads
      (id, tenant_id, contact_id, source, status, opportunity_value, page_path, created_at)
     values
      ($1, $2, $3, 'website', 'new', 120000, '/', $4),
      ($5, $2, $6, 'website', 'new', 90000, '/', $7)`,
    [
      "lead-current",
      tenantId,
      "contact-current",
      "2026-07-14T05:00:00.000Z",
      "lead-previous",
      "contact-previous",
      "2026-07-14T03:59:59.000Z",
    ],
  );
  await db.query(
    `insert into tasks
      (id, tenant_id, title, status, assigned_user_id, due_at, related_type, related_id, created_at)
     values
      ('task-overdue', $1, 'Rappeler le lead', 'open', $2, $3, 'contact', 'contact-current', $4),
      ('task-future', $1, 'Preparer le devis', 'open', $2, $5, 'contact', 'contact-current', $4),
      ('task-done', $1, 'Tache terminee', 'done', $2, $3, 'contact', 'contact-current', $4)`,
    [
      tenantId,
      userId,
      "2026-07-14T12:00:00.000Z",
      "2026-07-14T05:00:00.000Z",
      "2026-07-16T12:00:00.000Z",
    ],
  );
  await db.query(
    `insert into opportunities
      (id, tenant_id, contact_id, stage_id, value_cents, next_follow_up_at, lost_reason, created_at, updated_at)
     values
      ('opportunity-due', $1, 'contact-current', $2, 250000, $3, null, $4, $4),
      ('opportunity-future', $1, 'contact-previous', $2, 180000, $5, null, $4, $4)`,
    [
      tenantId,
      stageId,
      "2026-07-14T18:00:00.000Z",
      "2026-07-14T05:00:00.000Z",
      "2026-07-16T18:00:00.000Z",
    ],
  );
  await db.query(
    `insert into workflow_runs
      (id, tenant_id, workflow_key, trigger_name, status, summary, error, retry_count, created_at)
     values
      ('run-failed', $1, 'lead-follow-up', 'lead.created', 'failed', 'Relance lead en echec', 'safe_failure', 3, $2),
      ('run-cancelled', $1, 'lead-follow-up', 'lead.created', 'cancelled', 'Relance annulee', null, 0, $2)`,
    [tenantId, "2026-07-14T06:00:00.000Z"],
  );
  await db.query(
    `insert into domain_events
      (id, tenant_id, actor_id, event_type, payload, status, attempts, idempotency_key,
       correlation_id, next_run_at, last_error, last_attempted_at, last_retry_delay_ms,
       failure_classification, max_attempts, created_at, updated_at)
     values
      ('event-failed', $1, $2, 'lead.created', '{}', 'failed', 5, 'event-failed-key',
       'correlation-safe', $3, 'safe_failure', $3, 60000, 'terminal', 5, $3, $3),
      ('event-skipped', $1, $2, 'lead.created', '{}', 'skipped', 0, 'event-skipped-key',
       'correlation-skipped', $3, null, null, 0, null, 5, $3, $3)`,
    [tenantId, userId, "2026-07-14T06:00:00.000Z"],
  );
  await db.query(
    `insert into form_submissions
      (id, tenant_id, form_id, website_id, payload, created_contact_id, idempotency_key, created_at)
     values ('submission-one', $1, null, $2, '{}', 'contact-current', 'submission-key', $3)`,
    [tenantId, websiteId, "2026-07-14T05:00:00.000Z"],
  );
  await db.query(
    `insert into approvals
      (id, tenant_id, requested_by, policy, status, target_type, target_id, created_at)
     values ('approval-one', $1, $2, 'administrator_approval_required', 'pending', 'workflow_run', 'run-failed', $3)`,
    [tenantId, userId, "2026-07-14T06:00:00.000Z"],
  );
  await db.query(
    `insert into opportunity_radar_alerts
      (id, tenant_id, rule_key, severity, title, explanation, entity_type, entity_id,
       action_label, action_href, status, detected_at, created_at, updated_at)
     values
      ('radar-active', $1, 'overdue_task', 'critical', 'Tache critique', 'Une tache attend une action.',
       'task', 'task-overdue', 'Ouvrir', '/contacts/contact-current', 'active', $2, $2, $2),
      ('radar-resolved', $1, 'failed_workflow', 'warning', 'Ancienne alerte', 'Alerte resolue.',
       'workflow', 'run-cancelled', 'Ouvrir', '/automatisations', 'resolved', $2, $2, $2)`,
    [tenantId, "2026-07-14T06:00:00.000Z"],
  );
  await db.query(
    "update websites set current_draft_version_id = $1 where tenant_id = $2 and id = $3",
    ["draft-newer-than-publication", tenantId, websiteId],
  );
  await seedApiIntelligenceDashboard(db, userId, tenantId);
}

async function seedApiIntelligenceDashboard(
  db: DbClient,
  userId: string,
  tenantId: string,
) {
  const now = "2026-07-14T06:00:00.000Z";
  await db.query(
    `insert into software_directory_entries (
       id, canonical_name, aliases, vendor, official_domain, country,
       supported_regions, languages, industries, categories,
       official_website, developer_portal, support_page,
       partner_program_page, pricing_information_page, verification_status,
       confidence_score, last_verified_at, evidence_count, created_by,
       created_at, updated_at
     ) values (
       'dashboard-software', 'Dashboard API', '[]', 'Dashboard Vendor',
       'dashboard.example.test', null, '[]', '["fr"]', '[]', '[]',
       'https://dashboard.example.test', null, null, null, null, 'verified',
       100, $1, 1, $2, $1, $1
     )`,
    [now, userId],
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
       'dashboard-api', 'dashboard-software', 'Dashboard API', 'rest', '1',
       'https://api.dashboard.example.test',
       'https://dashboard.example.test/docs', null, null, null, 'none', '{}',
       '[]', 0, 1, 0, 'public', null, 'active', null, 100, $1, $1, $1
     )`,
    [now],
  );
  await db.query(
    `insert into api_sources (
       id, software_id, api_product_id, canonical_url, source_type,
       source_classification, publisher_domain, created_by, created_at
     ) values (
       'dashboard-source', 'dashboard-software', 'dashboard-api',
       'https://dashboard.example.test/openapi.json',
       'official_openapi_specification', 'official',
       'dashboard.example.test', $1, $2
     )`,
    [userId, now],
  );
  await db.query(
    `insert into api_source_recheck_schedules (
       id, source_id, context_tenant_id, configured_by, enabled,
       interval_seconds, next_run_at, processing_started_at, lease_id,
       last_run_at, last_success_at, last_status, consecutive_failures,
       last_error_code, created_at, updated_at
     ) values (
       'dashboard-recheck', 'dashboard-source', $1, $2, 1, 3600, $3,
       null, null, $3, null, 'blocked', 3, 'source_unavailable', $3, $3
     )`,
    [tenantId, userId, now],
  );
  for (const [snapshotId, hash] of [
    ["dashboard-snapshot-before", "a".repeat(64)],
    ["dashboard-snapshot-after", "b".repeat(64)],
  ]) {
    await db.query(
      `insert into api_source_snapshots (
         id, source_id, retrieved_at, http_status, etag, last_modified,
         content_hash, parser_version, robots_decision,
         access_policy_decision, content_type, content, safe_metadata,
         created_at
       ) values ($1, 'dashboard-source', $2, 200, null, null, $3,
         'dashboard-test', 'allowed', 'allowed', 'application/json', '{}',
         '{}', $2)`,
      [snapshotId, now, hash],
    );
  }
  await db.query(
    `insert into api_change_events (
       id, api_product_id, source_id, previous_snapshot_id,
       current_snapshot_id, primary_classification, classifications,
       summary, requires_approval, detected_at, created_at
     ) values (
       'dashboard-change', 'dashboard-api', 'dashboard-source',
       'dashboard-snapshot-before', 'dashboard-snapshot-after', 'breaking',
       '["breaking"]', '{}', 1, $1, $1
     )`,
    [now],
  );
  for (const suffix of ["one", "two"]) {
    const proposalId = `dashboard-proposal-${suffix}`;
    await db.query(
      `insert into connector_proposals (
         id, tenant_id, software_id, api_product_id, name, version, status,
         enabled, manifest, unresolved_questions, risk_assessment, created_by,
         created_at, updated_at
       ) values ($1, $2, 'dashboard-software', 'dashboard-api', $3, '0.1.0',
         'change_review_required', 0, '{}', '[]', '{}', $4, $5, $5)`,
      [proposalId, tenantId, `Connecteur ${suffix}`, userId, now],
    );
    await db.query(
      `insert into api_change_impacts (
         id, tenant_id, api_change_event_id, connector_proposal_id,
         contract_run_id, status, upgrade_blocked, repair_proposal,
         contract_test_status, contract_test_results, approval_status,
         decided_by, decision_reason, decided_at, created_at, updated_at
       ) values ($1, $2, 'dashboard-change', $3, null, 'review_required', 1,
         '{}', 'failed', '{}', 'pending', null, null, null, $4, $4)`,
      [`dashboard-impact-${suffix}`, tenantId, proposalId, now],
    );
  }
}
