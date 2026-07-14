import type { DbClient } from "@/lib/db";

export type ApiSourceRecheckScheduleRow = {
  id: string;
  source_id: string;
  context_tenant_id: string;
  configured_by: string;
  enabled: number;
  interval_seconds: number;
  next_run_at: string;
  processing_started_at: string | null;
  lease_id: string | null;
  last_run_at: string | null;
  last_success_at: string | null;
  last_status: string;
  consecutive_failures: number;
  last_error_code: string | null;
  created_at: string;
  updated_at: string;
};

const selectedColumns = `
  id,
  source_id,
  context_tenant_id,
  configured_by,
  enabled,
  interval_seconds,
  next_run_at,
  processing_started_at,
  lease_id,
  last_run_at,
  last_success_at,
  last_status,
  consecutive_failures,
  last_error_code,
  created_at,
  updated_at
`;

export async function upsertApiSourceRecheckSchedule(
  db: DbClient,
  input: {
    id: string;
    sourceId: string;
    contextTenantId: string;
    configuredBy: string;
    enabled: boolean;
    intervalSeconds: number;
    nextRunAt: string;
    now: string;
  },
) {
  const result = await db.query<ApiSourceRecheckScheduleRow>(
    `insert into api_source_recheck_schedules (
       id, source_id, context_tenant_id, configured_by, enabled, interval_seconds,
       next_run_at, processing_started_at, lease_id, last_run_at,
       last_success_at, last_status, consecutive_failures, last_error_code,
       created_at, updated_at
     ) values ($1, $2, $3, $4, $5, $6, $7, null, null, null, null, $8, 0, null, $9, $9)
     on conflict (source_id) do update
     set context_tenant_id = excluded.context_tenant_id,
         configured_by = excluded.configured_by,
         enabled = excluded.enabled,
         interval_seconds = excluded.interval_seconds,
         next_run_at = excluded.next_run_at,
         processing_started_at = null,
         lease_id = null,
         last_status = excluded.last_status,
         consecutive_failures = 0,
         last_error_code = null,
         updated_at = excluded.updated_at
     returning ${selectedColumns}`,
    [
      input.id,
      input.sourceId,
      input.contextTenantId,
      input.configuredBy,
      input.enabled ? 1 : 0,
      input.intervalSeconds,
      input.nextRunAt,
      input.enabled ? "scheduled" : "disabled",
      input.now,
    ],
  );

  return result.rows[0]!;
}

export async function listDueApiSourceRecheckSchedules(
  db: DbClient,
  now: string,
  limit: number,
) {
  const result = await db.query<ApiSourceRecheckScheduleRow>(
    `select ${selectedColumns}
     from api_source_recheck_schedules
     where enabled = 1
       and next_run_at <= $1
       and processing_started_at is null
     order by next_run_at asc, created_at asc
     limit ${limit}`,
    [now],
  );
  return result.rows;
}

export async function claimApiSourceRecheckSchedule(
  db: DbClient,
  input: {
    scheduleId: string;
    leaseId: string;
    now: string;
  },
) {
  const result = await db.query<ApiSourceRecheckScheduleRow>(
    `update api_source_recheck_schedules
     set processing_started_at = $1,
         lease_id = $2,
         last_status = 'processing',
         updated_at = $1
     where id = $3
       and enabled = 1
       and next_run_at <= $1
       and processing_started_at is null
     returning ${selectedColumns}`,
    [input.now, input.leaseId, input.scheduleId],
  );
  return result.rows[0] ?? null;
}

export async function requeueStaleApiSourceRechecks(
  db: DbClient,
  input: {
    staleBefore: string;
    retryAt: string;
    now: string;
  },
) {
  const result = await db.query<{ id: string }>(
    `update api_source_recheck_schedules
     set processing_started_at = null,
         lease_id = null,
         next_run_at = $1,
         last_status = 'retrying',
         consecutive_failures = consecutive_failures + 1,
         last_error_code = 'worker_lease_expired',
         updated_at = $2
     where enabled = 1
       and processing_started_at is not null
       and processing_started_at <= $3
     returning id`,
    [input.retryAt, input.now, input.staleBefore],
  );
  return result.rows.length;
}

export async function markApiSourceRecheckSucceeded(
  db: DbClient,
  input: {
    scheduleId: string;
    leaseId: string;
    nextRunAt: string;
    now: string;
  },
) {
  const result = await db.query<{ id: string }>(
    `update api_source_recheck_schedules
     set processing_started_at = null,
         lease_id = null,
         next_run_at = $1,
         last_run_at = $2,
         last_success_at = $2,
         last_status = 'succeeded',
         consecutive_failures = 0,
         last_error_code = null,
         updated_at = $2
     where id = $3 and lease_id = $4
     returning id`,
    [input.nextRunAt, input.now, input.scheduleId, input.leaseId],
  );
  return result.rows.length === 1;
}

export async function markApiSourceRecheckRetrying(
  db: DbClient,
  input: {
    scheduleId: string;
    leaseId: string;
    nextRunAt: string;
    errorCode: string;
    now: string;
  },
) {
  const result = await db.query<{ id: string }>(
    `update api_source_recheck_schedules
     set processing_started_at = null,
         lease_id = null,
         next_run_at = $1,
         last_run_at = $2,
         last_status = 'retrying',
         consecutive_failures = consecutive_failures + 1,
         last_error_code = $3,
         updated_at = $2
     where id = $4 and lease_id = $5
     returning id`,
    [
      input.nextRunAt,
      input.now,
      input.errorCode,
      input.scheduleId,
      input.leaseId,
    ],
  );
  return result.rows.length === 1;
}

export async function markApiSourceRecheckBlocked(
  db: DbClient,
  input: {
    scheduleId: string;
    leaseId: string;
    errorCode: string;
    now: string;
  },
) {
  const result = await db.query<{ id: string }>(
    `update api_source_recheck_schedules
     set enabled = 0,
         processing_started_at = null,
         lease_id = null,
         last_run_at = $1,
         last_status = 'blocked',
         consecutive_failures = consecutive_failures + 1,
         last_error_code = $2,
         updated_at = $1
     where id = $3 and lease_id = $4
     returning id`,
    [input.now, input.errorCode, input.scheduleId, input.leaseId],
  );
  return result.rows.length === 1;
}
