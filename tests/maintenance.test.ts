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
    });
    expect(await count(db, "audit_logs")).toBe(auditBefore + 1);
    const delivery = await db.query<{ idempotency_key: string | null }>(
      "select idempotency_key from webhook_deliveries where id = $1",
      ["delivery_old"],
    );
    expect(delivery.rows[0]?.idempotency_key).toBeNull();
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
