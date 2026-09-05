create unique index if not exists uq_invitations_tenant_id
  on invitations (tenant_id, id);

create table if not exists email_provider_deliveries (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  source_type text not null,
  source_id text not null,
  provider text not null,
  provider_message_id text not null,
  recipient_hash text not null,
  status text not null,
  last_event_at text,
  created_at text not null,
  updated_at text not null,
  unique (tenant_id, id),
  unique (tenant_id, id, provider_message_id),
  unique (provider, provider_message_id),
  foreign key (tenant_id, source_id)
    references invitations(tenant_id, id) on delete cascade,
  check (char_length(id) between 1 and 160),
  check (source_type = 'invitation'),
  check (char_length(source_id) between 1 and 160),
  check (provider = 'resend'),
  check (char_length(provider_message_id) between 1 and 256),
  check (provider_message_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'),
  check (recipient_hash ~ '^[A-Fa-f0-9]{64}$'),
  check (status in ('sent', 'delayed', 'delivered', 'failed')),
  check (updated_at >= created_at)
);

create table if not exists email_provider_events (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  delivery_id text not null,
  provider text not null,
  external_event_id text not null,
  provider_message_id text not null,
  event_type text not null,
  delivery_status text not null,
  occurred_at text not null,
  received_at text not null,
  unique (tenant_id, id),
  unique (provider, external_event_id),
  foreign key (tenant_id, delivery_id, provider_message_id)
    references email_provider_deliveries(
      tenant_id, id, provider_message_id
    ) on delete cascade,
  check (char_length(id) between 1 and 160),
  check (char_length(delivery_id) between 1 and 160),
  check (provider = 'resend'),
  check (char_length(external_event_id) between 1 and 256),
  check (external_event_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'),
  check (char_length(provider_message_id) between 1 and 256),
  check (provider_message_id ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'),
  check (event_type in (
    'email.sent',
    'email.delivered',
    'email.delivery_delayed',
    'email.bounced',
    'email.complained',
    'email.failed',
    'email.suppressed'
  )),
  check (delivery_status in ('sent', 'delayed', 'delivered', 'failed'))
);

create or replace function reject_email_provider_event_update()
returns trigger
language plpgsql
as $$
begin
  raise exception 'email_provider_events rows are immutable';
end;
$$;

drop trigger if exists email_provider_events_immutable_update
  on email_provider_events;
create trigger email_provider_events_immutable_update
before update on email_provider_events
for each row execute function reject_email_provider_event_update();

create index if not exists idx_email_provider_deliveries_tenant_provider
  on email_provider_deliveries (tenant_id, provider, provider_message_id);
create index if not exists idx_email_provider_deliveries_tenant_source
  on email_provider_deliveries (tenant_id, source_type, source_id, created_at desc);
create index if not exists idx_email_provider_events_tenant_delivery
  on email_provider_events (tenant_id, delivery_id, occurred_at, id);
create index if not exists idx_email_provider_events_tenant_external
  on email_provider_events (tenant_id, provider, external_event_id);
