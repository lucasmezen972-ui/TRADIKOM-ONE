create table if not exists github_public_connectors (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  owner_name text not null check (owner_name ~ '^[A-Za-z0-9][A-Za-z0-9-]{0,38}$'),
  repository_name text not null check (repository_name ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$'),
  status text not null check (status in ('active', 'revoked')),
  version integer not null default 1 check (version > 0),
  installed_by text not null references users(id),
  installed_at text not null,
  revoked_at text,
  last_requested_at timestamptz,
  last_checked_at text,
  latest_issues text not null default '[]' check (char_length(latest_issues) <= 20000),
  unique (tenant_id, owner_name, repository_name)
);
create or replace function protect_github_public_connector_identity() returns trigger
language plpgsql security invoker set search_path = pg_catalog, public, pg_temp as $$
begin
  if new.id <> old.id or new.tenant_id <> old.tenant_id or new.owner_name <> old.owner_name
    or new.repository_name <> old.repository_name or new.installed_by <> old.installed_by
    or new.installed_at <> old.installed_at then raise exception 'github_connector_identity_immutable'; end if;
  if old.status = 'revoked' or (new.status <> old.status and (new.status <> 'revoked' or new.version <> old.version + 1))
    or (new.status = old.status and new.version <> old.version) then raise exception 'github_connector_transition_invalid'; end if;
  return new;
end;
$$;
drop trigger if exists github_public_connector_identity on github_public_connectors;
create trigger github_public_connector_identity before update on github_public_connectors
for each row execute function protect_github_public_connector_identity();
