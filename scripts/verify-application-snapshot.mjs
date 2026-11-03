#!/usr/bin/env node
// Restore a private kit into a new disposable embedded PostgreSQL, never a live DB.
// Usage: node scripts/verify-application-snapshot.mjs KIT [PGLITE_MODULE]
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { XMLParser } from 'fast-xml-parser';

const root = path.resolve(process.argv[2]);
const { PGlite } = await import(process.argv[3] ?? '@electric-sql/pglite');
const db = new PGlite();
const qi = s => '"' + s.replaceAll('"', '""') + '"';
const normalize = values => values.map(v => JSON.stringify(v)).sort();
const acl = expressions => (expressions ?? []).map(a => ({ grantee:a.grantee, privilege:a.privilege, grantable:a.grantable }));
const parser = new XMLParser({ ignoreAttributes:true, parseTagValue:false });
const scopedNames = ['public', 'app_private'];
let stage = 'input_validation';
try {
  const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'snapshot.json'), 'utf8'));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
  assert.ok([1, 2].includes(snapshot.format_version), 'Unsupported snapshot format');
  const legacy = snapshot.format_version === 1;
  const schemas = legacy ? [{ name:'public', acl:snapshot.schema_acl }] : snapshot.schemas;
  assert.ok(Array.isArray(schemas) && schemas.length > 0);
  assert.ok(schemas.some(s => s.name === 'public'));
  assert.equal(new Set(schemas.map(s => s.name)).size, schemas.length);
  assert.ok(schemas.every(s => scopedNames.includes(s.name) && (legacy || typeof s.owner === 'string')));
  const schemaNames = schemas.map(s => s.name);
  const objectSchema = object => legacy ? 'public' : object.schema;
  const tables = snapshot.tables ?? [];
  const functions = snapshot.functions ?? [];
  for (const object of [...tables, ...functions]) {
    assert.ok(schemaNames.includes(objectSchema(object)), 'Object outside application schema scope');
  }
  assert.equal(new Set(tables.map(t => JSON.stringify([objectSchema(t), t.name]))).size, tables.length);
  assert.equal(new Set(functions.map(f => JSON.stringify([objectSchema(f), f.identity]))).size, functions.length);
  assert.ok((snapshot.default_acls ?? []).every(d => d.schema === null || schemaNames.includes(d.schema)));
  assert.ok(Object.values(snapshot.unsupported ?? {}).every(value => value === 0));

  const scalar = async (sql, params = []) => Number((await db.query(sql, params)).rows[0].n);
  stage = 'empty_local_target';
  // No path or connection URL is passed to PGlite; only this fresh local engine is used.
  assert.equal(await scalar("select count(*) n from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ('public','app_private') and c.relkind in ('r','p','v','m','S')"), 0);
  stage = 'restore';
  await db.exec(fs.readFileSync(path.join(root, 'restore_application.sql'), 'utf8'));

  stage = 'table_rows_and_metadata';
  assert.equal(await scalar("select count(*) n from pg_tables where schemaname = any($1::text[])", [schemaNames]), tables.length);
  let restoredRows = 0;
  let byteaColumnsVerified = 0;
  for (const table of tables) {
    const schema = objectSchema(table);
    const qualified = qi(schema) + '.' + qi(table.name);
    const expected = JSON.parse(parser.parse(table.data_xml).table.row.payload);
    // Match the export's canonical BYTEA representation even if bytea_output is changed.
    const columns = (await db.query("select a.attname from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname=$1 and c.relname=$2 and a.attnum>0 and not a.attisdropped and a.atttypid='pg_catalog.bytea'::regtype order by a.attnum", [schema, table.name])).rows;
    byteaColumnsVerified += columns.length;
    let projection = 'pg_catalog.to_jsonb(t)';
    if (!legacy && columns.length) {
      const fields = columns.map(column => {
        const name = "'" + column.attname.replaceAll("'", "''") + "'";
        const value = 't.' + qi(column.attname);
        return name + ', CASE WHEN ' + value + " IS NULL THEN NULL ELSE pg_catalog.chr(92) || 'x' || pg_catalog.encode(" + value + ", 'hex') END";
      });
      projection += ' || pg_catalog.jsonb_build_object(' + fields.join(', ') + ')';
    }
    const actual = (await db.query('select row_payload as row from (select ' + projection + ' as row_payload from ' + qualified + ' t) projected order by row_payload::text')).rows.map(r => r.row);
    assert.deepEqual(actual, expected);
    const entry = manifest.tables.find(t => (legacy ? 'public' : t.schema) === schema && t.table === table.name);
    assert.ok(entry, 'Missing table manifest entry');
    assert.equal(actual.length, entry.rows);
    restoredRows += actual.length;
    const info = (await db.query("select c.relrowsecurity as rls,c.relforcerowsecurity as force_rls,pg_get_userbyid(c.relowner) as owner from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname=$1 and c.relname=$2", [schema, table.name])).rows[0];
    assert.deepEqual(info, { rls:table.rls, force_rls:table.force_rls, owner:table.owner });
    const actualAcl = (await db.query("select case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee,a.privilege_type as privilege,a.is_grantable as grantable from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where n.nspname=$1 and c.relname=$2", [schema, table.name])).rows;
    assert.deepEqual(normalize(acl(actualAcl)), normalize(acl(table.acl)));
    const policies = (await db.query("select p.polname as name,p.polcmd as cmd,p.polpermissive as permissive,(select jsonb_agg(case when r=0 then 'public' else pg_get_userbyid(r) end order by case when r=0 then 'public' else pg_get_userbyid(r) end) from unnest(p.polroles) r) as roles,pg_get_expr(p.polqual,p.polrelid) as using,pg_get_expr(p.polwithcheck,p.polrelid) as check from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname=$1 and c.relname=$2 order by p.polname", [schema, table.name])).rows;
    const policyShape = p => ({ name:p.name, cmd:p.cmd, permissive:p.permissive, roles:[...(p.roles ?? [])].sort(), using:p.using, check:p.check });
    assert.deepEqual(policies.map(policyShape), table.policies.map(policyShape));
  }

  stage = 'functions_and_constraints';
  const applicationFunctionCount = await scalar("select count(*) n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=any($1::text[]) and p.prokind='f' and not exists(select 1 from pg_depend d where d.classid='pg_proc'::regclass and d.objid=p.oid and d.deptype='e')", [schemaNames]);
  assert.equal(applicationFunctionCount, functions.length);
  for (const f of functions) {
    const schema = objectSchema(f);
    const result = (await db.query("select pg_get_functiondef(p.oid) as definition,pg_get_userbyid(p.proowner) as owner from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname=$1 and format('%I(%s)',p.proname,pg_get_function_identity_arguments(p.oid))=$2", [schema, f.identity])).rows[0];
    assert.ok(result, 'Missing application function');
    assert.equal(result.owner, f.owner);
    assert.equal(result.definition, f.definition);
    const actualAcl = (await db.query("select case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee,a.privilege_type as privilege,a.is_grantable as grantable from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where n.nspname=$1 and format('%I(%s)',p.proname,pg_get_function_identity_arguments(p.oid))=$2", [schema, f.identity])).rows;
    assert.deepEqual(normalize(acl(actualAcl)), normalize(acl(f.acl)));
  }
  const constraints = await scalar("select count(*) n from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname=any($1::text[]) and k.contype<>'n'", [schemaNames]);
  const indexes = await scalar("select count(*) n from pg_indexes where schemaname=any($1::text[])", [schemaNames]);
  const triggers = await scalar("select count(*) n from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname=any($1::text[]) and not t.tgisinternal", [schemaNames]);
  assert.equal(constraints, tables.reduce((n,t) => n + t.constraints.length, 0));
  assert.equal(indexes, tables.reduce((n,t) => n + t.indexes.length + t.constraints.filter(c => ['p','u','x'].includes(c.kind)).length, 0));
  assert.equal(triggers, tables.reduce((n,t) => n + t.triggers.length, 0));

  stage = 'schema_and_default_privileges';
  const actualSchemaNames = (await db.query("select nspname as name from pg_namespace where nspname=any($1::text[]) order by nspname", [legacy ? ['public'] : scopedNames])).rows.map(s => s.name);
  assert.deepEqual(actualSchemaNames, [...schemaNames].sort());
  for (const schema of schemas) {
    const actual = (await db.query("select pg_get_userbyid(nspowner) as owner from pg_namespace where nspname=$1", [schema.name])).rows[0];
    assert.ok(actual, 'Missing application schema');
    if (!legacy) assert.equal(actual.owner, schema.owner);
    const schemaAcl = (await db.query("select case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee,a.privilege_type as privilege,a.is_grantable as grantable from pg_namespace n cross join lateral aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a where n.nspname=$1", [schema.name])).rows;
    assert.deepEqual(normalize(acl(schemaAcl)), normalize(acl(schema.acl)));
  }
  const defaultAcls = (await db.query("select pg_get_userbyid(d.defaclrole) as role,case when d.defaclnamespace=0 then null else n.nspname end as schema,d.defaclobjtype as type,(select jsonb_agg(jsonb_build_object('grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) order by a.grantee,a.privilege_type) from aclexplode(d.defaclacl) a) as entries from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace where d.defaclnamespace=0 or n.nspname=any($1::text[])", [schemaNames])).rows;
  const defaultShape = d => ({ role:d.role, schema:d.schema, type:d.type, entries:normalize(acl(d.entries)) });
  assert.deepEqual(normalize(defaultAcls.map(defaultShape)), normalize((snapshot.default_acls ?? []).map(defaultShape)));

  stage = 'asset_quota_accounting';
  let assetQuotaAccountingExact = false;
  if (tables.some(t => objectSchema(t) === 'app_private' && t.name === 'tenant_asset_usage')
    && tables.some(t => objectSchema(t) === 'public' && t.name === 'tenant_assets')) {
    const actual = (await db.query("select scope_key,used_bytes::text as bytes,used_count::text as count from app_private.tenant_asset_usage order by scope_key")).rows;
    const expected = (await db.query("select scope_key,bytes,count from (select 'global'::text as scope_key,coalesce(sum(byte_size),0)::text as bytes,count(*)::text as count from public.tenant_assets union all select 'tenant:'||tenant_id,sum(byte_size)::text,count(*)::text from public.tenant_assets group by tenant_id) totals order by scope_key")).rows;
    assert.deepEqual(actual, expected);
    assetQuotaAccountingExact = true;
  }

  stage = 'role_memberships';
  const memberships = (await db.query("select r.rolname as role,m.rolname as member,a.admin_option as admin,a.inherit_option as inherit,a.set_option as set from pg_auth_members a join pg_roles r on r.oid=a.roleid join pg_roles m on m.oid=a.member where r.rolname like 'tradikom_%' and m.rolname like 'tradikom_%' order by r.rolname,m.rolname")).rows;
  const shape = m => ({ role:m.role, member:m.member, admin:m.admin, inherit:m.inherit, set:m.set });
  assert.deepEqual(memberships.map(shape), snapshot.memberships.map(shape));
  for (const role of snapshot.roles.filter(r => r.name.startsWith('tradikom_'))) {
    const actual = (await db.query("select rolinherit,rolsuper,rolbypassrls,rolcanlogin,coalesce(to_jsonb(rolconfig),'[]'::jsonb) as config from pg_roles where rolname=$1", [role.name])).rows[0];
    assert.deepEqual(actual, { rolinherit:role.inherit, rolsuper:false, rolbypassrls:false, rolcanlogin:false, config:role.config });
  }
  stage = 'restricted_role';
  const administrator = (await db.query('select session_user as name')).rows[0].name;
  const owner = (await db.query("select user_id,tenant_id from public.memberships where role='owner' order by tenant_id limit 1")).rows[0];
  assert.ok(owner, 'Owner fixture required for this restore qualification');
  await db.exec('set session authorization tradikom_web_preview');
  const runtime = (await db.query('select current_user as name,rolsuper,rolbypassrls from pg_roles where rolname=current_user')).rows[0];
  assert.deepEqual(runtime, { name:'tradikom_web_preview', rolsuper:false, rolbypassrls:false });
  let ownerDenied = false;
  try { await db.exec('set role tradikom_owner'); } catch (e) { ownerDenied = e.code === '42501'; }
  assert.ok(ownerDenied);
  assert.equal(await scalar('select count(*) n from public.memberships'), 0);
  await db.exec('begin');
  await db.query("select set_config('app.tenant_id',$1,true),set_config('app.actor_id',$2,true)", [owner.tenant_id, owner.user_id]);
  assert.equal(await scalar('select count(*) n from public.memberships where tenant_id=public.app_current_tenant_id()'), 1);
  assert.equal(await scalar('select count(*) n from public.business_profiles where tenant_id=public.app_current_tenant_id()'), 1);
  await db.exec('commit');
  assert.equal(await scalar('select count(*) n from public.memberships'), 0);
  await db.exec('begin');
  await db.query("select set_config('app.tenant_id','restore-unrelated-tenant',true),set_config('app.actor_id',$1,true)", [owner.user_id]);
  assert.equal(await scalar('select count(*) n from public.business_profiles'), 0);
  await db.exec('rollback');
  // An embedded engine can have an empty bootstrap reset value. Restore the
  // original local identity explicitly instead of relying on RESET's default.
  await db.exec('set session authorization ' + qi(administrator));
  assert.equal((await db.query('select current_user as name')).rows[0].name, administrator);
  const proof = { verifiedAt:new Date().toISOString(), capturedAt:snapshot.captured_at,
    formatVersion:snapshot.format_version, schemas:schemaNames,
    engine:(await db.query('show server_version')).rows[0].server_version,
    restoredTables:tables.length, restoredRows, constraints, indexes, triggers,
    policies:tables.reduce((n,t) => n + t.policies.length, 0),
    functions:functions.length, allRowsExact:true, migrationJournalExact:true,
    byteaColumnsVerified, byteaHexQualified:!legacy && byteaColumnsVerified > 0,
    assetQuotaAccountingExact,
    tableOwnersRlsPoliciesAndAclsExact:true, functionDefinitionsOwnersAndAclsExact:true,
    schemaAndDefaultPrivilegesExact:true, schemaOwnersExact:!legacy,
    restoredCustomRolesWithoutLoginOrBypass:true, roleMembershipsExact:true,
    restrictedRoleAndContextReset:true, localAdministratorIdentityRestored:true,
    scope:legacy
      ? 'public application schema only; no platform restore or target engine qualification'
      : 'public and app_private application schemas only; no platform restore or target engine qualification' };
  fs.writeFileSync(path.join(root, 'verification.json'), JSON.stringify(proof, null, 2), { mode:0o600, flag:'wx' });
  console.log(JSON.stringify(proof));
} catch (error) {
  console.error(JSON.stringify({ failedStage:stage, code:error.code ?? 'ASSERTION_FAILED' }));
  process.exitCode = 1;
} finally {
  await db.close();
}
