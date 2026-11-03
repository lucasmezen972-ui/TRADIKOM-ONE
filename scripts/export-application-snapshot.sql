-- Read-only, one-statement snapshot of public + app_private application objects.
-- Result contains private data: encrypt it before off-site storage; never log it.
-- Not a platform backup. No role passwords, Vault plaintext, Auth or Storage data.
with app_schemas as materialized (
  select n.* from pg_namespace n where n.nspname in ('public','app_private')
), app_tables as materialized (
  select c.*, n.nspname as schema_name,
    'pg_catalog.to_jsonb(t)' || coalesce((
      select ' || pg_catalog.jsonb_build_object(' || string_agg(
        format('%L, CASE WHEN t.%I IS NULL THEN NULL ELSE pg_catalog.chr(92) || ''x'' || pg_catalog.encode(t.%I, ''hex'') END',
          a.attname,a.attname,a.attname), ', ' order by a.attnum) || ')'
      from pg_attribute a where a.attrelid=c.oid and a.attnum>0
        and not a.attisdropped and a.atttypid='pg_catalog.bytea'::regtype
    ), '') as row_projection
  from pg_class c join app_schemas n on n.oid=c.relnamespace
  where c.relkind in ('r','p')
), app_functions as materialized (
  select p.*, n.nspname as schema_name from pg_proc p join app_schemas n on n.oid=p.pronamespace
  where p.prokind='f'
    and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass
      and d.objid=p.oid and d.deptype='e')
)
select jsonb_build_object(
  'format_version', 2,
  'captured_at', statement_timestamp(),
  'server_version', current_setting('server_version'),
  'scope', 'public and app_private application schemas; excludes platform internals and secret values',
  'unsupported', jsonb_build_object(
    'sequences', (select count(*) from pg_class c join app_schemas n on n.oid=c.relnamespace where c.relkind='S'),
    'views', (select count(*) from pg_class c join app_schemas n on n.oid=c.relnamespace where c.relkind in ('v','m')),
    'custom_types', (select count(*) from pg_type t join app_schemas n on n.oid=t.typnamespace where t.typtype in ('e','d')),
    'partitions', (select count(*) from app_tables where relkind='p' or relispartition),
    'generated_columns', (select count(*) from pg_attribute a join app_tables t on t.oid=a.attrelid where a.attnum>0 and not a.attisdropped and (a.attidentity<>'' or a.attgenerated<>''))
  ),
  'extensions', (select jsonb_agg(jsonb_build_object('name',e.extname,'version',e.extversion,'schema',n.nspname) order by e.extname) from pg_extension e join pg_namespace n on n.oid=e.extnamespace),
  'roles', (select jsonb_agg(jsonb_build_object('name',rolname,'inherit',rolinherit,'login',rolcanlogin,'config',(
    select coalesce(jsonb_agg(setting order by setting),'[]'::jsonb) from unnest(rolconfig) setting
    where split_part(setting,'=',1) in ('search_path','statement_timeout','idle_in_transaction_session_timeout')
  )) order by rolname) from pg_roles where rolname in ('tradikom_app','tradikom_owner','tradikom_web_preview','anon','authenticated','service_role','supabase_admin','postgres')),
  'memberships', (select coalesce(jsonb_agg(jsonb_build_object('role',r.rolname,'member',m.rolname,'admin',a.admin_option,'inherit',a.inherit_option,'set',a.set_option) order by r.rolname,m.rolname),'[]'::jsonb) from pg_auth_members a join pg_roles r on r.oid=a.roleid join pg_roles m on m.oid=a.member where r.rolname like 'tradikom_%' and m.rolname like 'tradikom_%'),
  'schemas', (select jsonb_agg(jsonb_build_object('name',n.nspname,'owner',pg_get_userbyid(n.nspowner),
    'acl',(select jsonb_agg(jsonb_build_object('grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) order by a.grantee,a.privilege_type) from aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a)
  ) order by n.nspname) from app_schemas n),
  'default_acls', (select jsonb_agg(jsonb_build_object('role',pg_get_userbyid(d.defaclrole),'schema',case when d.defaclnamespace=0 then null else n.nspname end,'type',d.defaclobjtype,'entries',(select jsonb_agg(jsonb_build_object('grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) order by a.grantee,a.privilege_type) from aclexplode(d.defaclacl) a)) order by pg_get_userbyid(d.defaclrole),n.nspname nulls first,d.defaclobjtype) from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace where d.defaclnamespace=0 or n.nspname in ('public','app_private')),
  'functions', (select jsonb_agg(jsonb_build_object(
    'schema',p.schema_name,'identity', format('%I(%s)',p.proname,pg_get_function_identity_arguments(p.oid)),
    'owner',pg_get_userbyid(p.proowner),'definition',pg_get_functiondef(p.oid),
    'acl',(select jsonb_agg(jsonb_build_object('grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) order by a.grantee,a.privilege_type) from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a)
  ) order by p.schema_name,p.proname,pg_get_function_identity_arguments(p.oid)) from app_functions p),
  'tables', (select jsonb_agg(jsonb_build_object(
    'schema',t.schema_name,'name',t.relname,'owner',pg_get_userbyid(t.relowner),'rls',t.relrowsecurity,'force_rls',t.relforcerowsecurity,
    'columns',(select jsonb_agg(jsonb_build_object('name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'notnull',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated) order by a.attnum) from pg_attribute a left join pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum where a.attrelid=t.oid and a.attnum>0 and not a.attisdropped),
    'constraints',(select coalesce(jsonb_agg(jsonb_build_object('kind',k.contype,'name',k.conname,'definition',pg_get_constraintdef(k.oid)) order by k.conname),'[]'::jsonb) from pg_constraint k where k.conrelid=t.oid and k.contype<>'n'),
    'indexes',(select coalesce(jsonb_agg(pg_get_indexdef(i.indexrelid) order by c.relname),'[]'::jsonb) from pg_index i join pg_class c on c.oid=i.indexrelid where i.indrelid=t.oid and not exists(select 1 from pg_constraint k where k.conindid=i.indexrelid and k.contype in ('p','u','x'))),
    'triggers',(select coalesce(jsonb_agg(pg_get_triggerdef(g.oid) order by g.tgname),'[]'::jsonb) from pg_trigger g where g.tgrelid=t.oid and not g.tgisinternal),
    'policies',(select coalesce(jsonb_agg(jsonb_build_object('name',p.polname,'cmd',p.polcmd,'permissive',p.polpermissive,'roles',(select jsonb_agg(case when r=0 then 'public' else pg_get_userbyid(r) end order by case when r=0 then 'public' else pg_get_userbyid(r) end) from unnest(p.polroles) r),'using',pg_get_expr(p.polqual,p.polrelid),'check',pg_get_expr(p.polwithcheck,p.polrelid)) order by p.polname),'[]'::jsonb) from pg_policy p where p.polrelid=t.oid),
    'acl',(select jsonb_agg(jsonb_build_object('grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) order by a.grantee,a.privilege_type) from aclexplode(coalesce(t.relacl,acldefault('r',t.relowner))) a),
    'data_xml', query_to_xml(format('select coalesce(pg_catalog.jsonb_agg(row_payload order by row_payload::text), ''[]''::jsonb)::text as payload from (select %s as row_payload from %I.%I t) projected',t.row_projection,t.schema_name,t.relname),false,false,'')::text
  ) order by t.schema_name,t.relname) from app_tables t)
) as snapshot;
