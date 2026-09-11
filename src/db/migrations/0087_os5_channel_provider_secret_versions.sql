create table if not exists channel_provider_secret_versions (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  provider text not null,
  endpoint_id text not null,
  channel_identity_id text,
  secret_scope text not null,
  encrypted_payload text not null,
  key_version text not null,
  secret_version integer not null,
  rotation_key_hash text not null,
  revoked_at text,
  revoked_by text references users(id) on delete restrict,
  created_by text not null references users(id) on delete restrict,
  created_at text not null,
  unique (tenant_id, id),
  unique (tenant_id, provider, rotation_key_hash),
  foreign key (tenant_id, endpoint_id)
    references channel_provider_endpoints(tenant_id, id) on delete cascade,
  foreign key (tenant_id, channel_identity_id)
    references conversation_channel_identities(tenant_id, id) on delete cascade,
  check (char_length(id) between 1 and 160),
  check (provider = 'whatsapp_twilio'),
  check (char_length(endpoint_id) between 1 and 160),
  check (
    (secret_scope = 'endpoint' and channel_identity_id is null)
    or (secret_scope = 'identity' and channel_identity_id is not null)
  ),
  check (char_length(encrypted_payload) between 64 and 16384),
  check (char_length(key_version) between 1 and 80),
  check (key_version ~ '^[A-Za-z0-9][A-Za-z0-9._:-]*$'),
  check (secret_version between 1 and 1000000),
  check (rotation_key_hash ~ '^[a-f0-9]{64}$'),
  check (
    (revoked_at is null and revoked_by is null)
    or (revoked_at is not null and revoked_by is not null and revoked_at >= created_at)
  )
);

create unique index if not exists uq_channel_provider_secret_endpoint_version
  on channel_provider_secret_versions (
    tenant_id, provider, endpoint_id, secret_version
  ) where secret_scope = 'endpoint';
create unique index if not exists uq_channel_provider_secret_identity_version
  on channel_provider_secret_versions (
    tenant_id, provider, endpoint_id, channel_identity_id, secret_version
  ) where secret_scope = 'identity';
create unique index if not exists uq_channel_provider_secret_endpoint_active
  on channel_provider_secret_versions (tenant_id, provider, endpoint_id)
  where secret_scope = 'endpoint' and revoked_at is null;
create unique index if not exists uq_channel_provider_secret_identity_active
  on channel_provider_secret_versions (
    tenant_id, provider, endpoint_id, channel_identity_id
  ) where secret_scope = 'identity' and revoked_at is null;
create index if not exists idx_channel_provider_secret_versions_tenant_scope
  on channel_provider_secret_versions (
    tenant_id, provider, secret_scope, endpoint_id, channel_identity_id,
    secret_version desc
  );

create or replace function protect_channel_provider_secret_version()
returns trigger
language plpgsql
as $$
begin
  if new.tenant_id <> old.tenant_id
     or new.provider <> old.provider
     or new.endpoint_id <> old.endpoint_id
     or new.channel_identity_id is distinct from old.channel_identity_id
     or new.secret_scope <> old.secret_scope
     or new.encrypted_payload <> old.encrypted_payload
     or new.key_version <> old.key_version
     or new.secret_version <> old.secret_version
     or new.rotation_key_hash <> old.rotation_key_hash
     or new.created_by <> old.created_by
     or new.created_at <> old.created_at
     or (old.revoked_at is not null and (
       new.revoked_at is distinct from old.revoked_at
       or new.revoked_by is distinct from old.revoked_by
     ))
     or ((new.revoked_at is null) <> (new.revoked_by is null)) then
    raise exception 'channel_provider_secret_version_immutable';
  end if;
  return new;
end;
$$;

drop trigger if exists channel_provider_secret_versions_protect
  on channel_provider_secret_versions;
create trigger channel_provider_secret_versions_protect
before update on channel_provider_secret_versions
for each row execute function protect_channel_provider_secret_version();
