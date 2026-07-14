import { afterEach, describe, expect, it } from "vitest";
import { createMemoryDb, type DbClient } from "../src/lib/db";
import { createServices } from "../src/lib/services";
import {
  processDueApiSourceRechecks,
  type DiscoveryTransport,
} from "../src/modules/api-intelligence";
import { setPlatformRole } from "../src/modules/platform-admin";
import { runWorkerBatch } from "../src/worker/runtime";

const databases: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(databases.splice(0).map((database) => database.close()));
});

describe("scheduled API source rechecks", () => {
  it("rechecks an approved source with validators and does not duplicate a 304 snapshot", async () => {
    const context = await setupSource();
    const now = new Date("2026-07-13T12:00:00.000Z");
    let sourceRequests = 0;
    const transport: DiscoveryTransport = async (url, input) => {
      if (url.pathname === "/robots.txt") return allowedRobots();
      sourceRequests += 1;
      if (sourceRequests === 2) {
        expect(input.headers).toMatchObject({
          "if-none-match": '"scheduled-v1"',
          "if-modified-since": "Mon, 13 Jul 2026 11:00:00 GMT",
        });
        return {
          status: 304,
          headers: { etag: '"scheduled-v1"' },
          body: "",
        };
      }
      return {
        status: 200,
        headers: {
          "content-type": "application/json",
          etag: '"scheduled-v1"',
          "last-modified": "Mon, 13 Jul 2026 11:00:00 GMT",
        },
        body: JSON.stringify({ openapi: "3.0.3", paths: {} }),
      };
    };

    await context.services.configureApiSourceRecheck(
      context.adminId,
      context.tenantId,
      { sourceId: context.sourceId, enabled: true, intervalSeconds: 3_600 },
    );
    await makeDue(context.db, context.sourceId, now);

    const workerBatch = await runWorkerBatch({
      db: context.db,
      now,
      batchSize: 3,
      discoveryTransport: transport,
    });
    const first = workerBatch.sourceRechecks;
    expect(first).toMatchObject({
      selected: 1,
      processed: 1,
      succeeded: 1,
      retried: 0,
      blocked: 0,
    });
    expect(await loadSchedule(context.db, context.sourceId)).toMatchObject({
      enabled: 1,
      next_run_at: "2026-07-13T13:00:00.000Z",
      last_status: "succeeded",
      consecutive_failures: 0,
      last_error_code: null,
      processing_started_at: null,
      lease_id: null,
    });

    const secondNow = new Date("2026-07-13T13:00:00.000Z");
    const second = await processDueApiSourceRechecks(context.db, {
      now: secondNow,
      transport,
    });
    expect(second.succeeded).toBe(1);
    expect(sourceRequests).toBe(2);
    const snapshotCount = await context.db.query<{ count: number }>(
      "select count(*)::int as count from api_source_snapshots where source_id = $1",
      [context.sourceId],
    );
    expect(snapshotCount.rows[0]?.count).toBe(1);

    const workspace = await context.services.getApiIntelligenceWorkspace(
      context.adminId,
      context.tenantId,
    );
    expect(workspace.sources[0]?.recheck).toMatchObject({
      enabled: true,
      intervalSeconds: 3_600,
      status: "succeeded",
      failureCount: 0,
    });
    await expectAuditActions(context.db, context.tenantId, [
      "api_intelligence.recheck_enabled",
      "api_intelligence.source_fetched",
      "api_intelligence.source_not_modified",
    ]);
  });

  it("blocks a due schedule before network access when its domain is paused", async () => {
    const context = await setupSource();
    const now = new Date("2026-07-13T12:00:00.000Z");
    let requests = 0;

    await context.services.configureApiSourceRecheck(
      context.adminId,
      context.tenantId,
      { sourceId: context.sourceId, enabled: true, intervalSeconds: 3_600 },
    );
    await context.services.decideSoftwareDomain(
      context.adminId,
      context.tenantId,
      {
        domainId: context.domainId,
        status: "paused",
        reason: "Verification automatique suspendue.",
      },
    );
    await makeDue(context.db, context.sourceId, now);

    const summary = await processDueApiSourceRechecks(context.db, {
      now,
      transport: async () => {
        requests += 1;
        return allowedRobots();
      },
    });

    expect(summary).toMatchObject({ blocked: 1, succeeded: 0, retried: 0 });
    expect(requests).toBe(0);
    expect(await loadSchedule(context.db, context.sourceId)).toMatchObject({
      enabled: 0,
      last_status: "blocked",
      last_error_code: "domain_not_approved",
      consecutive_failures: 1,
    });
  });

  it("retries transient failures with exponential backoff and stores only a safe code", async () => {
    const context = await setupSource();
    const now = new Date("2026-07-13T12:00:00.000Z");

    await context.services.configureApiSourceRecheck(
      context.adminId,
      context.tenantId,
      { sourceId: context.sourceId, enabled: true, intervalSeconds: 3_600 },
    );
    await makeDue(context.db, context.sourceId, now);

    const failed = await processDueApiSourceRechecks(context.db, {
      now,
      baseBackoffMs: 60_000,
      transport: async () => {
        throw new Error("token=must-never-be-persisted");
      },
    });
    expect(failed.retried).toBe(1);
    const retrying = await loadSchedule(context.db, context.sourceId);
    expect(retrying).toMatchObject({
      enabled: 1,
      next_run_at: "2026-07-13T12:01:00.000Z",
      last_status: "retrying",
      last_error_code: "recheck_failed",
      consecutive_failures: 1,
    });
    expect(JSON.stringify(retrying)).not.toContain("must-never-be-persisted");

    const recovered = await processDueApiSourceRechecks(context.db, {
      now: new Date("2026-07-13T12:01:00.000Z"),
      transport: successfulTransport(),
    });
    expect(recovered.succeeded).toBe(1);
    expect(await loadSchedule(context.db, context.sourceId)).toMatchObject({
      last_status: "succeeded",
      last_error_code: null,
      consecutive_failures: 0,
    });
  });

  it("moves repeated transient failures to a terminal blocked state", async () => {
    const context = await setupSource();
    const now = new Date("2026-07-13T12:00:00.000Z");
    await context.services.configureApiSourceRecheck(
      context.adminId,
      context.tenantId,
      { sourceId: context.sourceId, enabled: true, intervalSeconds: 3_600 },
    );
    await context.db.query(
      `update api_source_recheck_schedules
       set next_run_at = $1, consecutive_failures = 2
       where source_id = $2`,
      [now.toISOString(), context.sourceId],
    );

    const exhausted = await processDueApiSourceRechecks(context.db, {
      now,
      maxAttempts: 3,
      transport: async () => {
        throw new Error("credential=must-not-be-stored");
      },
    });

    expect(exhausted).toMatchObject({ blocked: 1, retried: 0 });
    const schedule = await loadSchedule(context.db, context.sourceId);
    expect(schedule).toMatchObject({
      enabled: 0,
      last_status: "blocked",
      last_error_code: "max_attempts_exceeded",
      consecutive_failures: 3,
    });
    expect(JSON.stringify(schedule)).not.toContain("must-not-be-stored");
  });

  it("stops a schedule when the configuring administrator loses platform authority", async () => {
    const context = await setupSource();
    const now = new Date("2026-07-13T12:00:00.000Z");
    let requests = 0;

    await context.services.configureApiSourceRecheck(
      context.adminId,
      context.tenantId,
      { sourceId: context.sourceId, enabled: true, intervalSeconds: 3_600 },
    );
    await setPlatformRole(context.db, context.adminId, "user");
    await makeDue(context.db, context.sourceId, now);

    const summary = await processDueApiSourceRechecks(context.db, {
      now,
      transport: async () => {
        requests += 1;
        return allowedRobots();
      },
    });
    expect(summary.blocked).toBe(1);
    expect(requests).toBe(0);
    expect(await loadSchedule(context.db, context.sourceId)).toMatchObject({
      enabled: 0,
      last_status: "blocked",
      last_error_code: "platform_admin_required",
    });
  });

  it("requeues an expired worker lease before safely resuming", async () => {
    const context = await setupSource();
    const now = new Date("2026-07-13T12:00:00.000Z");
    await context.services.configureApiSourceRecheck(
      context.adminId,
      context.tenantId,
      { sourceId: context.sourceId, enabled: true, intervalSeconds: 3_600 },
    );
    await context.db.query(
      `update api_source_recheck_schedules
       set next_run_at = $1,
           processing_started_at = $2,
           lease_id = $3,
           last_status = 'processing'
       where source_id = $4`,
      [
        "2026-07-13T11:00:00.000Z",
        "2026-07-13T11:50:00.000Z",
        "expired-lease",
        context.sourceId,
      ],
    );

    const requeued = await processDueApiSourceRechecks(context.db, {
      now,
      baseBackoffMs: 60_000,
      processingTimeoutMs: 5 * 60_000,
      transport: successfulTransport(),
    });
    expect(requeued).toMatchObject({ requeued: 1, selected: 0 });
    expect(await loadSchedule(context.db, context.sourceId)).toMatchObject({
      next_run_at: "2026-07-13T12:01:00.000Z",
      last_status: "retrying",
      last_error_code: "worker_lease_expired",
      lease_id: null,
    });

    const resumed = await processDueApiSourceRechecks(context.db, {
      now: new Date("2026-07-13T12:01:00.000Z"),
      transport: successfulTransport(),
    });
    expect(resumed.succeeded).toBe(1);
  });

  it("respects the batch bound and ignores disabled schedules", async () => {
    const context = await setupSource();
    const second = await context.services.addOfficialApiSource(
      context.adminId,
      context.tenantId,
      {
        softwareId: context.softwareId,
        apiProductId: context.apiProductId,
        url: "https://docs.scheduled-source.test/openapi-secondary.json",
        sourceType: "official_openapi_specification",
      },
    );
    const now = new Date("2026-07-13T12:00:00.000Z");
    for (const sourceId of [context.sourceId, second.sourceId]) {
      await context.services.configureApiSourceRecheck(
        context.adminId,
        context.tenantId,
        { sourceId, enabled: true, intervalSeconds: 3_600 },
      );
      await makeDue(context.db, sourceId, now);
    }

    const first = await processDueApiSourceRechecks(context.db, {
      now,
      limit: 1,
      transport: successfulTransport(),
    });
    expect(first).toMatchObject({ selected: 1, processed: 1, succeeded: 1 });
    const snapshots = await context.db.query<{ count: number }>(
      "select count(*)::int as count from api_source_snapshots",
    );
    expect(snapshots.rows[0]?.count).toBe(1);

    await context.services.configureApiSourceRecheck(
      context.adminId,
      context.tenantId,
      { sourceId: second.sourceId, enabled: false, intervalSeconds: 3_600 },
    );
    await makeDue(context.db, second.sourceId, now);
    const disabled = await processDueApiSourceRechecks(context.db, {
      now,
      transport: successfulTransport(),
    });
    expect(disabled.selected).toBe(0);
  });
});

async function setupSource() {
  const db = await createMemoryDb();
  databases.push(db);
  const services = createServices(db);
  const admin = await services.registerUser({
    name: "Admin planification",
    email: "scheduled-admin@example.com",
    password: "Password!1",
  });
  const tenant = await services.createTenant(admin.id, {
    name: "Tenant planification",
    category: "Services",
  });
  await setPlatformRole(db, admin.id, "platform_admin");
  const software = await services.createSoftwareDirectoryEntry(
    admin.id,
    tenant.id,
    {
      canonicalName: "Scheduled Source",
      aliases: [],
      vendor: "Scheduled Source SAS",
      officialDomain: "docs.scheduled-source.test",
      supportedRegions: ["Europe"],
      languages: ["fr"],
      industries: ["Services"],
      categories: ["API"],
      officialWebsite: "https://docs.scheduled-source.test/",
    },
  );
  await services.decideSoftwareDomain(admin.id, tenant.id, {
    domainId: software.domainId,
    status: "approved",
    reason: "Domaine officiel verifie.",
  });
  const product = await services.createApiProductRecord(admin.id, tenant.id, {
    softwareId: software.softwareId,
    name: "Scheduled Source API",
    apiStyle: "rest",
    version: "v1",
    documentationUrl: "https://docs.scheduled-source.test/openapi.json",
  });
  const source = await services.addOfficialApiSource(admin.id, tenant.id, {
    softwareId: software.softwareId,
    apiProductId: product.apiProductId,
    url: "https://docs.scheduled-source.test/openapi.json",
    sourceType: "official_openapi_specification",
  });
  return {
    db,
    services,
    adminId: admin.id,
    tenantId: tenant.id,
    domainId: software.domainId,
    softwareId: software.softwareId,
    apiProductId: product.apiProductId,
    sourceId: source.sourceId,
  };
}

function allowedRobots() {
  return {
    status: 200,
    headers: { "content-type": "text/plain" },
    body: "User-agent: TradikomApiScout\nAllow: /",
  };
}

function successfulTransport(): DiscoveryTransport {
  return async (url) => {
    if (url.pathname === "/robots.txt") return allowedRobots();
    return {
      status: 200,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ openapi: "3.0.3", paths: {} }),
    };
  };
}

async function makeDue(db: DbClient, sourceId: string, now: Date) {
  await db.query(
    `update api_source_recheck_schedules
     set next_run_at = $1
     where source_id = $2`,
    [now.toISOString(), sourceId],
  );
}

async function loadSchedule(db: DbClient, sourceId: string) {
  const result = await db.query<Record<string, unknown>>(
    "select * from api_source_recheck_schedules where source_id = $1",
    [sourceId],
  );
  return result.rows[0];
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
  for (const action of expected) expect(actions).toContain(action);
}
