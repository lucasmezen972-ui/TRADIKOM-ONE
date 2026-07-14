create index if not exists idx_domain_events_tenant_status_schedule
  on domain_events(tenant_id, status, next_run_at, updated_at);

create index if not exists idx_workflow_runs_tenant_status_created
  on workflow_runs(tenant_id, status, created_at desc);

create index if not exists idx_notifications_tenant_channel_status
  on notifications(tenant_id, channel, status, created_at desc);

create index if not exists idx_connectors_tenant_health_updated
  on connectors(tenant_id, health, updated_at desc);

create index if not exists idx_connector_sync_runs_tenant_status
  on connector_sync_runs(tenant_id, status, created_at desc);

create index if not exists idx_webhook_deliveries_tenant_status
  on webhook_deliveries(tenant_id, status, created_at desc);

create index if not exists idx_webhook_endpoints_tenant_status
  on webhook_endpoints(tenant_id, status);

create index if not exists idx_connector_contract_runs_tenant_status
  on connector_contract_runs(tenant_id, status, created_at desc);

create index if not exists idx_api_change_impacts_tenant_blocked
  on api_change_impacts(tenant_id, upgrade_blocked, updated_at desc);

create index if not exists idx_api_source_rechecks_context_status
  on api_source_recheck_schedules(context_tenant_id, last_status, next_run_at);
