alter table webhook_deliveries add column if not exists idempotency_key text;
create index if not exists idx_webhook_deliveries_endpoint_idempotency
  on webhook_deliveries(webhook_endpoint_id, idempotency_key);
create unique index if not exists idx_webhook_deliveries_accepted_idempotency
  on webhook_deliveries(webhook_endpoint_id, idempotency_key)
  where idempotency_key is not null and status = 'accepted';
