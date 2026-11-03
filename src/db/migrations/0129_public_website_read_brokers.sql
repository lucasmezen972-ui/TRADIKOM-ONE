-- Public reads have no tenant cookie. These fixed, read-only brokers expose
-- only a coherent immutable publication, never editable drafts or raw assets.
-- No app.system_access flag or additional table privilege is used.
create schema if not exists app_private;
revoke all on schema app_private from public;


-- Nullable bytes preserve every existing external object. New PostgreSQL
-- objects carry their complete immutable content in the tenant-scoped row.
alter table public.tenant_assets add column if not exists storage_backend text not null default 'external';
alter table public.tenant_assets add column if not exists content_bytes bytea;
alter table public.tenant_assets drop constraint if exists tenant_assets_storage_payload_valid;
alter table public.tenant_assets add constraint tenant_assets_storage_payload_valid check (
  (storage_backend = 'external' and content_bytes is null and storage_key not like 'dbasset:%')
  or (storage_backend = 'postgres' and content_bytes is not null
    and storage_key = 'dbasset:' || tenant_id || ':' || id
    and byte_size between 1 and 3145728
    and pg_catalog.octet_length(content_bytes) = byte_size
    and checksum = pg_catalog.encode(pg_catalog.sha256(content_bytes), 'hex')
    and case content_type
      when 'image/png' then pg_catalog.substr(content_bytes, 1, 8) = pg_catalog.decode('89504e470d0a1a0a', 'hex')
      when 'image/jpeg' then pg_catalog.substr(content_bytes, 1, 3) = pg_catalog.decode('ffd8ff', 'hex')
      when 'image/webp' then pg_catalog.octet_length(content_bytes) >= 12
        and pg_catalog.substr(content_bytes, 1, 4) = pg_catalog.decode('52494646', 'hex')
        and pg_catalog.substr(content_bytes, 9, 4) = pg_catalog.decode('57454250', 'hex')
      else false
    end)
);

-- Counters have no runtime table privilege and no RLS policy: only their
-- owner can access them. A global row serializes all quota reservations.
create table if not exists app_private.tenant_asset_usage (
  scope_key text primary key check (scope_key = 'global' or scope_key like 'tenant:%'),
  used_bytes bigint not null check (used_bytes >= 0),
  used_count bigint not null check (used_count >= 0)
);
alter table app_private.tenant_asset_usage enable row level security;
revoke all on table app_private.tenant_asset_usage from public;
revoke truncate on table public.tenant_assets from public;

-- Bootstrap only under the migration identity and an asset-table write lock.
-- Do not clamp or delete old assets if their existing totals exceed the cap.
-- The DO statement also makes this bootstrap atomic in the local fallback.
do $$
begin
  lock table public.tenant_assets in share row exclusive mode;
  delete from app_private.tenant_asset_usage;
  insert into app_private.tenant_asset_usage (scope_key, used_bytes, used_count)
    select 'global', coalesce(sum(a.byte_size), 0), count(*) from public.tenant_assets a;
  insert into app_private.tenant_asset_usage (scope_key, used_bytes, used_count)
    select 'tenant:' || a.tenant_id, sum(a.byte_size), count(*)
    from public.tenant_assets a group by a.tenant_id;
end;
$$;

create or replace function app_private.enforce_tenant_asset_storage()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  asset_tenant_id text;
  asset_byte_size integer;
begin
  if tg_op = 'UPDATE' then
    if new is distinct from old then raise exception 'asset_immutable'; end if;
    return new;
  end if;
  if tg_op = 'INSERT' then
    asset_tenant_id := new.tenant_id;
    asset_byte_size := new.byte_size;
    if asset_byte_size < 1 or (new.storage_backend = 'postgres' and asset_byte_size > 3145728) then raise exception 'asset_storage_invalid'; end if;
  else
    asset_tenant_id := old.tenant_id;
    asset_byte_size := old.byte_size;
  end if;

  -- Match service ordering: tenant first, then global usage, then tenant usage.
  -- During ON DELETE CASCADE the parent is already absent in this transaction.
  perform 1 from public.tenants t where t.id = asset_tenant_id for update;
  if tg_op = 'INSERT' and not found then raise exception 'asset_storage_invalid'; end if;
  -- BEFORE locks precede FK key-share locks. AFTER accounting runs only for
  -- effective rows, so ON CONFLICT DO NOTHING cannot consume quota.
  if tg_when = 'BEFORE' then
    if tg_op = 'INSERT' then return new; else return old; end if;
  end if;
  if tg_op = 'INSERT' then
    update app_private.tenant_asset_usage
      set used_bytes = used_bytes + asset_byte_size, used_count = used_count + 1
      where scope_key = 'global' and used_bytes <= 52428800 - asset_byte_size
        and used_count < 512;
    if not found then raise exception 'asset_quota_exceeded'; end if;
    insert into app_private.tenant_asset_usage (scope_key, used_bytes, used_count)
      values ('tenant:' || asset_tenant_id, 0, 0) on conflict (scope_key) do nothing;
    update app_private.tenant_asset_usage
      set used_bytes = used_bytes + asset_byte_size, used_count = used_count + 1
      where scope_key = 'tenant:' || asset_tenant_id
        and used_bytes <= 10485760 - asset_byte_size and used_count < 64;
    if not found then raise exception 'asset_quota_exceeded'; end if;
    return new;
  end if;

  update app_private.tenant_asset_usage
    set used_bytes = used_bytes - asset_byte_size, used_count = used_count - 1
    where scope_key = 'global' and used_bytes >= asset_byte_size and used_count >= 1;
  if not found then raise exception 'asset_quota_counter_invalid'; end if;
  update app_private.tenant_asset_usage
    set used_bytes = used_bytes - asset_byte_size, used_count = used_count - 1
    where scope_key = 'tenant:' || asset_tenant_id
      and used_bytes >= asset_byte_size and used_count >= 1;
  if not found then raise exception 'asset_quota_counter_invalid'; end if;
  delete from app_private.tenant_asset_usage
    where scope_key = 'tenant:' || asset_tenant_id and used_count = 0 and used_bytes = 0;
  return old;
end;
$$;
revoke all on function app_private.enforce_tenant_asset_storage() from public;
drop trigger if exists tenant_asset_storage_integrity on public.tenant_assets;
drop trigger if exists tenant_asset_storage_reservation on public.tenant_assets;
create trigger tenant_asset_storage_integrity before insert or update or delete on public.tenant_assets
  for each row execute function app_private.enforce_tenant_asset_storage();
create trigger tenant_asset_storage_reservation after insert or delete on public.tenant_assets
  for each row execute function app_private.enforce_tenant_asset_storage();

create or replace function app_private.app_public_site_by_slug(lookup_slug text)
returns table (tenant_id text, tenant_slug text, website jsonb, sections jsonb)
language plpgsql stable security definer
set search_path = '' as $$
declare
  selected_tenant_id text;
  selected_slug text;
  selected_website_id text;
  selected_version_id text;
  selected_published_at text;
  selected_snapshot text;
  published jsonb;
begin
  select t.id, t.slug, p.website_id, p.version_id, p.published_at, v.snapshot
    into selected_tenant_id, selected_slug, selected_website_id,
      selected_version_id, selected_published_at, selected_snapshot
  from public.tenants t
  join public.website_publications p on p.tenant_id = t.id
  join public.websites w on w.id = p.website_id and w.tenant_id = p.tenant_id
  join public.website_versions v on v.id = p.version_id
    and v.tenant_id = p.tenant_id and v.website_id = p.website_id
    and v.version_type = 'published'
  where t.slug = lookup_slug
  order by p.published_at desc, p.id desc
  limit 1;
  if not found then return; end if;
  begin
    published := selected_snapshot::jsonb;
  exception when invalid_text_representation then return;
  end;
  if pg_catalog.jsonb_typeof(published -> 'website') is distinct from 'object'
    or pg_catalog.jsonb_typeof(published -> 'sections') is distinct from 'array'
    or published -> 'website' ->> 'id' is distinct from selected_website_id
    or published -> 'website' ->> 'tenantId' is distinct from selected_tenant_id then
    return;
  end if;
  return query select selected_tenant_id, selected_slug,
    pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'id', selected_website_id, 'tenantId', selected_tenant_id,
      'name', published -> 'website' -> 'name',
      'templateKey', published -> 'website' -> 'templateKey',
      'status', 'published', 'theme', published -> 'website' -> 'theme',
      'currentVersionId', selected_version_id,
      'currentPublishedVersionId', selected_version_id,
      'createdAt', published -> 'website' -> 'createdAt',
      'updatedAt', published -> 'website' -> 'updatedAt',
      'publishedAt', selected_published_at
    )),
    coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
      'id', s.value -> 'id', 'tenantId', selected_tenant_id,
      'websiteId', selected_website_id, 'type', s.value -> 'type',
      'position', s.value -> 'position', 'enabled', true,
      'title', s.value -> 'title', 'body', s.value -> 'body',
      'imageUrl', s.value -> 'imageUrl', 'buttonLabel', s.value -> 'buttonLabel',
      'buttonHref', s.value -> 'buttonHref', 'data', s.value -> 'data'
    )) order by s.ordinality)
    from pg_catalog.jsonb_array_elements(published -> 'sections') with ordinality s(value, ordinality)
    where s.value -> 'enabled' = 'true'::jsonb
      and s.value ->> 'tenantId' = selected_tenant_id
      and s.value ->> 'websiteId' = selected_website_id), '[]'::jsonb);
end;
$$;

drop function if exists app_private.app_public_asset_by_id(text);
create function app_private.app_public_asset_by_id(lookup_asset_id text)
returns table (content_type text, byte_size integer, checksum text, storage_key text, storage_backend text, content_bytes bytea)
language sql stable security definer
set search_path = '' as $$
  select a.content_type, a.byte_size, a.checksum, a.storage_key, a.storage_backend, a.content_bytes
  from public.tenant_assets a
  join public.tenants t on t.id = a.tenant_id
  cross join lateral app_private.app_public_site_by_slug(t.slug) p
  where a.id = lookup_asset_id and p.tenant_id = a.tenant_id
    and exists (
      select 1 from pg_catalog.jsonb_array_elements(p.sections) s(value)
      where s.value ->> 'imageUrl' = '/fichiers/' || a.id
    )
  limit 1;
$$;

revoke all on function app_private.app_public_site_by_slug(text) from public;
revoke all on function app_private.app_public_asset_by_id(text) from public;

-- These are the versioned deployment identities. A custom runtime remains
-- denied until its dedicated identity is explicitly provisioned by migration.
do $$
begin
  if not exists (select 1 from pg_catalog.pg_roles where rolname = 'tradikom_owner')
    and exists (select 1 from pg_catalog.pg_roles where rolname in ('tradikom_app', 'tradikom_web_preview')) then
    raise exception 'public_website_owner_required';
  end if;
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'tradikom_owner') then
    alter schema app_private owner to tradikom_owner;
    alter table app_private.tenant_asset_usage owner to tradikom_owner;
    alter function app_private.enforce_tenant_asset_storage() owner to tradikom_owner;
    alter function app_private.app_public_site_by_slug(text) owner to tradikom_owner;
    alter function app_private.app_public_asset_by_id(text) owner to tradikom_owner;
  end if;
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'anon') then
    revoke all on schema app_private from anon;
    revoke all on table app_private.tenant_asset_usage from anon;
    revoke all on function app_private.enforce_tenant_asset_storage() from anon;
    revoke truncate on table public.tenant_assets from anon;
    revoke all on function app_private.app_public_site_by_slug(text) from anon;
    revoke all on function app_private.app_public_asset_by_id(text) from anon;
  end if;
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'authenticated') then
    revoke all on schema app_private from authenticated;
    revoke all on table app_private.tenant_asset_usage from authenticated;
    revoke all on function app_private.enforce_tenant_asset_storage() from authenticated;
    revoke truncate on table public.tenant_assets from authenticated;
    revoke all on function app_private.app_public_site_by_slug(text) from authenticated;
    revoke all on function app_private.app_public_asset_by_id(text) from authenticated;
  end if;
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') then
    revoke all on schema app_private from service_role;
    revoke all on table app_private.tenant_asset_usage from service_role;
    revoke all on function app_private.enforce_tenant_asset_storage() from service_role;
    revoke truncate on table public.tenant_assets from service_role;
    revoke all on function app_private.app_public_site_by_slug(text) from service_role;
    revoke all on function app_private.app_public_asset_by_id(text) from service_role;
  end if;
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'tradikom_app') then
    grant usage on schema app_private to tradikom_app;
    revoke all on table app_private.tenant_asset_usage from tradikom_app;
    revoke all on function app_private.enforce_tenant_asset_storage() from tradikom_app;
    revoke truncate on table public.tenant_assets from tradikom_app;
    grant execute on function app_private.app_public_site_by_slug(text) to tradikom_app;
    grant execute on function app_private.app_public_asset_by_id(text) to tradikom_app;
  end if;
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'tradikom_web_preview') then
    grant usage on schema app_private to tradikom_web_preview;
    revoke all on table app_private.tenant_asset_usage from tradikom_web_preview;
    revoke all on function app_private.enforce_tenant_asset_storage() from tradikom_web_preview;
    revoke truncate on table public.tenant_assets from tradikom_web_preview;
    grant execute on function app_private.app_public_site_by_slug(text) to tradikom_web_preview;
    grant execute on function app_private.app_public_asset_by_id(text) to tradikom_web_preview;
  end if;
end;
$$;
