import type { DbClient } from "@/lib/db";

type OperationalSignalsRow = {
  queue_due: number | string;
  queue_scheduled: number | string;
  queue_processing: number | string;
  queue_stale: number | string;
  queue_failed: number | string;
  workflow_failed: number | string;
  workflow_waiting: number | string;
  connector_errors: number | string;
  connector_warnings: number | string;
  connector_sync_failures_24h: number | string;
  email_queued: number | string;
  email_sent_24h: number | string;
  email_dispatch_failures_24h: number | string;
  api_blocked: number | string;
  api_retrying: number | string;
  api_due: number | string;
  api_failed_contracts_24h: number | string;
  api_blocked_impacts: number | string;
  webhook_rejections_24h: number | string;
  webhook_disabled: number | string;
};

export type OperationalSignals = ReturnType<typeof mapOperationalSignals>;

export async function readTenantOperationalSignals(
  db: DbClient,
  tenantId: string,
  input: {
    now: string;
    recentSince: string;
    staleSince: string;
  },
) {
  const result = await db.query<OperationalSignalsRow>(
    `select
       (select count(*)::int from domain_events
        where tenant_id = $1 and status = 'pending' and next_run_at <= $2)
         as queue_due,
       (select count(*)::int from domain_events
        where tenant_id = $1 and status = 'pending' and next_run_at > $2)
         as queue_scheduled,
       (select count(*)::int from domain_events
        where tenant_id = $1 and status = 'processing')
         as queue_processing,
       (select count(*)::int from domain_events
        where tenant_id = $1 and status = 'processing' and updated_at <= $3)
         as queue_stale,
       (select count(*)::int from domain_events
        where tenant_id = $1 and status = 'failed')
         as queue_failed,
       (select count(*)::int from workflow_runs
        where tenant_id = $1 and status = 'failed')
         as workflow_failed,
       (select count(*)::int from workflow_runs
        where tenant_id = $1 and status in ('waiting', 'approval_required'))
         as workflow_waiting,
       (select count(*)::int from connectors
        where tenant_id = $1 and health = 'error')
         as connector_errors,
       (select count(*)::int from connectors
        where tenant_id = $1 and health = 'warning')
         as connector_warnings,
       (select count(*)::int from connector_sync_runs
        where tenant_id = $1 and status = 'failed' and created_at >= $4)
         as connector_sync_failures_24h,
       (select count(*)::int from notifications
        where tenant_id = $1 and channel = 'email' and status = 'queued')
         as email_queued,
       (select count(*)::int from notifications
        where tenant_id = $1 and channel = 'email' and status = 'sent'
          and created_at >= $4)
         as email_sent_24h,
       (select count(*)::int from domain_events
        where tenant_id = $1 and event_type = 'notification.dispatch_requested'
          and status = 'failed' and updated_at >= $4)
         as email_dispatch_failures_24h,
       (select count(*)::int from api_source_recheck_schedules
        where context_tenant_id = $1 and last_status = 'blocked')
         as api_blocked,
       (select count(*)::int from api_source_recheck_schedules
        where context_tenant_id = $1 and last_status = 'retrying')
         as api_retrying,
       (select count(*)::int from api_source_recheck_schedules
        where context_tenant_id = $1 and enabled = 1 and next_run_at <= $2)
         as api_due,
       (select count(*)::int from connector_contract_runs
        where tenant_id = $1 and status = 'failed' and created_at >= $4)
         as api_failed_contracts_24h,
       (select count(*)::int from api_change_impacts
        where tenant_id = $1 and upgrade_blocked = 1)
         as api_blocked_impacts,
       (select count(*)::int from webhook_deliveries
        where tenant_id = $1 and status <> 'accepted' and created_at >= $4)
         as webhook_rejections_24h,
       (select count(*)::int from webhook_endpoints
        where tenant_id = $1 and status = 'disabled')
         as webhook_disabled`,
    [tenantId, input.now, input.staleSince, input.recentSince],
  );

  return mapOperationalSignals(result.rows[0]);
}

function mapOperationalSignals(row: OperationalSignalsRow | undefined) {
  return {
    queueDue: toCount(row?.queue_due),
    queueScheduled: toCount(row?.queue_scheduled),
    queueProcessing: toCount(row?.queue_processing),
    queueStale: toCount(row?.queue_stale),
    queueFailed: toCount(row?.queue_failed),
    workflowFailed: toCount(row?.workflow_failed),
    workflowWaiting: toCount(row?.workflow_waiting),
    connectorErrors: toCount(row?.connector_errors),
    connectorWarnings: toCount(row?.connector_warnings),
    connectorSyncFailures24h: toCount(row?.connector_sync_failures_24h),
    emailQueued: toCount(row?.email_queued),
    emailSent24h: toCount(row?.email_sent_24h),
    emailDispatchFailures24h: toCount(row?.email_dispatch_failures_24h),
    apiBlocked: toCount(row?.api_blocked),
    apiRetrying: toCount(row?.api_retrying),
    apiDue: toCount(row?.api_due),
    apiFailedContracts24h: toCount(row?.api_failed_contracts_24h),
    apiBlockedImpacts: toCount(row?.api_blocked_impacts),
    webhookRejections24h: toCount(row?.webhook_rejections_24h),
    webhookDisabled: toCount(row?.webhook_disabled),
  };
}

function toCount(value: number | string | undefined) {
  const count = Number(value ?? 0);
  return Number.isFinite(count) && count > 0 ? count : 0;
}
