import type { DbClient } from "@/lib/db";
import { createDatabaseRateLimiter } from "@/modules/rate-limit";

export const maintenanceRetentionDays = {
  revokedSessions: 30,
  consumedResetTokens: 30,
  completedInvitations: 90,
  formSubmissionIdempotency: 180,
  webhookIdempotency: 180,
} as const;

export type MaintenanceSummary = {
  expiredSessions: number;
  revokedSessions: number;
  expiredResetTokens: number;
  consumedResetTokens: number;
  markedExpiredInvitations: number;
  completedInvitations: number;
  rateLimitBuckets: number;
  formSubmissionRecords: number;
  webhookIdempotencyKeys: number;
};

export async function runMaintenance(
  db: DbClient,
  options: { now?: Date; batchSize?: number } = {},
): Promise<MaintenanceSummary> {
  const now = options.now ?? new Date();
  const batchSize = boundedBatchSize(options.batchSize);
  const nowIso = now.toISOString();

  return {
    expiredSessions: await deleteBounded(
      db,
      "sessions",
      "expires_at <= $1",
      [nowIso],
      batchSize,
    ),
    revokedSessions: await deleteBounded(
      db,
      "sessions",
      "revoked_at is not null and revoked_at <= $1",
      [before(now, maintenanceRetentionDays.revokedSessions)],
      batchSize,
    ),
    expiredResetTokens: await deleteBounded(
      db,
      "password_reset_tokens",
      "used_at is null and expires_at <= $1",
      [nowIso],
      batchSize,
    ),
    consumedResetTokens: await deleteBounded(
      db,
      "password_reset_tokens",
      "used_at is not null and used_at <= $1",
      [before(now, maintenanceRetentionDays.consumedResetTokens)],
      batchSize,
    ),
    markedExpiredInvitations: await markExpiredInvitations(db, nowIso, batchSize),
    completedInvitations: await deleteBounded(
      db,
      "invitations",
      "status in ('expired', 'revoked', 'accepted') and created_at <= $1",
      [before(now, maintenanceRetentionDays.completedInvitations)],
      batchSize,
    ),
    rateLimitBuckets:
      (await createDatabaseRateLimiter(db).cleanup?.({
        before: now,
        limit: batchSize,
      })) ?? 0,
    formSubmissionRecords: await deleteBounded(
      db,
      "form_submissions",
      "created_at <= $1",
      [before(now, maintenanceRetentionDays.formSubmissionIdempotency)],
      batchSize,
    ),
    webhookIdempotencyKeys: await clearWebhookIdempotencyKeys(
      db,
      before(now, maintenanceRetentionDays.webhookIdempotency),
      batchSize,
    ),
  };
}

async function deleteBounded(
  db: DbClient,
  table: string,
  predicate: string,
  params: unknown[],
  limit: number,
) {
  const limitParameter = params.length + 1;
  const result = await db.query<{ id: string }>(
    `delete from ${table}
     where id in (
       select id from ${table}
       where ${predicate}
       order by id
       limit $${limitParameter}
     )
     returning id`,
    [...params, limit],
  );
  return result.rows.length;
}

async function markExpiredInvitations(
  db: DbClient,
  nowIso: string,
  limit: number,
) {
  const result = await db.query<{ id: string }>(
    `update invitations
     set status = 'expired'
     where id in (
       select id from invitations
       where status = 'pending' and expires_at <= $1
       order by expires_at asc
       limit $2
     )
     returning id`,
    [nowIso, limit],
  );
  return result.rows.length;
}

async function clearWebhookIdempotencyKeys(
  db: DbClient,
  cutoff: string,
  limit: number,
) {
  const result = await db.query<{ id: string }>(
    `update webhook_deliveries
     set idempotency_key = null
     where id in (
       select id from webhook_deliveries
       where idempotency_key is not null and created_at <= $1
       order by created_at asc
       limit $2
     )
     returning id`,
    [cutoff, limit],
  );
  return result.rows.length;
}

function boundedBatchSize(value?: number) {
  if (!value || !Number.isInteger(value)) return 500;
  return Math.max(1, Math.min(5_000, value));
}

function before(now: Date, days: number) {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}
