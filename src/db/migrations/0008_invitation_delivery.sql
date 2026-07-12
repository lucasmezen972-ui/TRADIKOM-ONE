alter table invitations add column if not exists delivery_status text not null default 'pending';
alter table invitations add column if not exists delivery_provider text;
alter table invitations add column if not exists delivery_attempts integer not null default 0;
alter table invitations add column if not exists delivery_last_attempt_at text;
alter table invitations add column if not exists delivery_error_code text;

create index if not exists idx_invitations_delivery_status
  on invitations(tenant_id, delivery_status, created_at desc);
