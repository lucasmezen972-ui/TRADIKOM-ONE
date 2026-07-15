import type { DbClient } from "@/lib/db";
import { enqueueDueMockOAuthRefreshes } from "@/modules/oauth";
import { createDatabaseRateLimiter } from "@/modules/rate-limit";

export const maintenanceRetentionDays = {
  revokedSessions: 30,
  consumedResetTokens: 30,
  completedInvitations: 90,
  formSubmissionIdempotency: 180,
  webhookIdempotency: 180,
  completedDomainEvents: 90,
  sentNotifications: 180,
  unreferencedApiSourceSnapshots: 365,
  connectorContractRuns: 180,
  supersededConnectorProposals: 365,
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
  completedDomainEvents: number;
  sentNotifications: number;
  apiSourceSnapshots: number;
  connectorContractRuns: number;
  connectorProposals: number;
  expiredExports: number;
  oauthRefreshEvents: number;
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
    completedDomainEvents: await deleteBounded(
      db,
      "domain_events",
      "status in ('succeeded', 'skipped') and updated_at <= $1",
      [before(now, maintenanceRetentionDays.completedDomainEvents)],
      batchSize,
    ),
    sentNotifications: await deleteBounded(
      db,
      "notifications",
      "status = 'sent' and created_at <= $1",
      [before(now, maintenanceRetentionDays.sentNotifications)],
      batchSize,
    ),
    apiSourceSnapshots: await deleteUnreferencedApiSourceSnapshots(
      db,
      before(now, maintenanceRetentionDays.unreferencedApiSourceSnapshots),
      batchSize,
    ),
    connectorContractRuns: await deleteOldConnectorContractRuns(
      db,
      before(now, maintenanceRetentionDays.connectorContractRuns),
      batchSize,
    ),
    connectorProposals: await deleteOldConnectorProposals(
      db,
      before(now, maintenanceRetentionDays.supersededConnectorProposals),
      batchSize,
    ),
    expiredExports: await expireExportFiles(db, nowIso, batchSize),
    oauthRefreshEvents: (
      await enqueueDueMockOAuthRefreshes(db, {
        now,
        limit: batchSize,
      })
    ).queued,
  };
}

async function expireExportFiles(
  db: DbClient,
  nowIso: string,
  limit: number,
) {
  const result = await db.query<{ id: string }>(
    `update export_jobs
        set status = 'expired', safe_content = null, content_encoding = null,
            updated_at = $1
      where id in (
        select id from export_jobs
        where status = 'completed' and expires_at <= $1
        order by expires_at, id
        limit $2
      )
      returning id`,
    [nowIso, limit],
  );
  return result.rows.length;
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

async function deleteUnreferencedApiSourceSnapshots(
  db: DbClient,
  cutoff: string,
  limit: number,
) {
  const result = await db.query<{ id: string }>(
    `delete from api_source_snapshots
     where id in (
       select snapshots.id
       from api_source_snapshots as snapshots
       where snapshots.created_at <= $1
         and not exists (
           select 1 from api_schemas where source_snapshot_id = snapshots.id
         )
         and not exists (
           select 1 from api_operations where source_snapshot_id = snapshots.id
         )
         and not exists (
           select 1 from api_claims where source_snapshot_id = snapshots.id
         )
         and not exists (
           select 1 from api_evidence where source_snapshot_id = snapshots.id
         )
         and not exists (
           select 1 from api_change_events
           where previous_snapshot_id = snapshots.id
              or current_snapshot_id = snapshots.id
         )
         and not exists (
           select 1 from connector_repair_proposals
           where source_snapshot_id = snapshots.id
         )
       order by snapshots.created_at asc, snapshots.id asc
       limit $2
     )
     returning id`,
    [cutoff, limit],
  );
  return result.rows.length;
}

async function deleteOldConnectorContractRuns(
  db: DbClient,
  cutoff: string,
  limit: number,
) {
  const result = await db.query<{ id: string }>(
    `delete from connector_contract_runs
     where id in (
       select runs.id
       from connector_contract_runs as runs
       where runs.created_at <= $1
         and not exists (
           select 1 from api_change_impacts
           where contract_run_id = runs.id
         )
         and exists (
           select 1 from connector_contract_runs as newer
           where newer.tenant_id = runs.tenant_id
             and newer.connector_proposal_id = runs.connector_proposal_id
             and (
               newer.created_at > runs.created_at
               or (newer.created_at = runs.created_at and newer.id > runs.id)
             )
         )
       order by runs.created_at asc, runs.id asc
       limit $2
     )
     returning id`,
    [cutoff, limit],
  );
  return result.rows.length;
}

async function deleteOldConnectorProposals(
  db: DbClient,
  cutoff: string,
  limit: number,
) {
  const result = await db.query<{ id: string }>(
    `delete from connector_proposals
     where id in (
       select proposals.id
       from connector_proposals as proposals
       where proposals.updated_at <= $1
         and proposals.status in ('superseded', 'rejected', 'abandoned')
         and not exists (
           select 1 from connector_contract_runs
           where connector_proposal_id = proposals.id
         )
         and not exists (
           select 1 from connector_approval_requests
           where connector_proposal_id = proposals.id
         )
         and not exists (
           select 1 from private_connect_store_entries
           where connector_proposal_id = proposals.id
         )
         and not exists (
           select 1 from api_change_impacts
           where connector_proposal_id = proposals.id
         )
         and not exists (
           select 1 from connector_repair_proposals
           where source_connector_proposal_id = proposals.id
              or replacement_connector_proposal_id = proposals.id
         )
       order by proposals.updated_at asc, proposals.id asc
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
