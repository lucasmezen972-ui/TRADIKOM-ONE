-- Read-only compatibility probe for the Supabase PostgreSQL 17.11 upgrade.
-- Source: https://supabase.com/changelog/postgres-15-19-17-11-breaking-changes
-- No row content, secrets, ciphertext, extension changes or reindexing.
with affected_indexes as (
  select distinct n.nspname as schema_name, ic.relname as index_name, am.amname,
    ty.typname
  from pg_catalog.pg_index idx
  join pg_catalog.pg_class ic on idx.indexrelid = ic.oid
  join pg_catalog.pg_am am on am.oid = ic.relam
  join pg_catalog.pg_namespace n on n.oid = ic.relnamespace
  join lateral unnest(idx.indclass::oid[]) with ordinality as k(opclass, pos) on true
  join pg_catalog.pg_opclass oc on oc.oid = k.opclass
  join pg_catalog.pg_type ty on ty.oid = oc.opcintype
  where k.pos <= idx.indnkeyatts
    and n.nspname not in ('pg_catalog', 'information_schema')
    and (ty.typname in ('ltree', '_ltree')
      or (am.amname = 'gist' and ty.typname in ('float4', 'float8')))
), custom_operators as (
  select n.nspname as schema_name, o.oprname as operator_name
  from pg_catalog.pg_operator o
  join pg_catalog.pg_namespace n on n.oid = o.oprnamespace
  where n.nspname not in ('pg_catalog', 'information_schema')
    and ((o.oprrest <> 0 and o.oprrest::oid >= 10000)
      or (o.oprjoin <> 0 and o.oprjoin::oid >= 10000))
    and not exists (
      select 1 from pg_catalog.pg_depend d
      where d.classid = 'pg_catalog.pg_operator'::regclass and d.objid = o.oid and d.deptype = 'e'
    )
)
select jsonb_build_object(
  'checked_at', current_timestamp,
  'postgres_version', current_setting('server_version'),
  'application_migrations', (select count(*) from public.schema_migrations),
  'database_bytes', pg_catalog.pg_database_size(current_database()),
  'extensions', (select jsonb_agg(jsonb_build_object('name', e.extname, 'version', e.extversion, 'schema', n.nspname) order by e.extname)
    from pg_catalog.pg_extension e join pg_catalog.pg_namespace n on n.oid = e.extnamespace),
  'affected_indexes', coalesce((select jsonb_agg(to_jsonb(i)) from affected_indexes i), '[]'::jsonb),
  'custom_selectivity_operators', coalesce((select jsonb_agg(to_jsonb(o)) from custom_operators o), '[]'::jsonb),
  'logical_replication_slots', (select count(*) from pg_catalog.pg_replication_slots where slot_type = 'logical'),
  'public_pgp_function_references', (select count(*) from pg_catalog.pg_proc p
    join pg_catalog.pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.prosrc ~* 'pgp_(sym|pub)_(encrypt|decrypt)'),
  'pgcrypto_legacy_data_scan', 'not_performed',
  'platform_backup_restore', 'not_proven'
) as upgrade_probe;

