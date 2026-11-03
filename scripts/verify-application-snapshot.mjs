#!/usr/bin/env node
// Restore a private kit into disposable embedded PostgreSQL, never the live DB.
// Usage: node scripts/verify-application-snapshot.mjs KIT [PGLITE_MODULE]
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { XMLParser } from 'fast-xml-parser';

const root = path.resolve(process.argv[2]);
const { PGlite } = await import(process.argv[3] ?? '@electric-sql/pglite');
const snapshot = JSON.parse(fs.readFileSync(path.join(root, 'snapshot.json'), 'utf8'));
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const db = new PGlite();
const qi = s => '"' + s.replaceAll('"', '""') + '"';
const normalize = values => values.map(v => JSON.stringify(v)).sort();
const acl = expressions => expressions.map(a => ({ grantee: a.grantee, privilege: a.privilege, grantable: a.grantable }));
const parser = new XMLParser({ ignoreAttributes: true, parseTagValue: false });
let stage = 'restore';
try {
  await db.exec(fs.readFileSync(path.join(root, 'restore_application.sql'), 'utf8'));
  const scalar = async sql => Number((await db.query(sql)).rows[0].n);
  stage = 'table_rows_and_metadata';
  assert.equal(await scalar("select count(*) n from pg_tables where schemaname='public'"), snapshot.tables.length);
  let restoredRows = 0;
  for (const table of snapshot.tables) {
    const expected = JSON.parse(parser.parse(table.data_xml).table.row.payload);
    const actual = (await db.query('select to_jsonb(t) as row from public.' + qi(table.name) + ' t order by to_jsonb(t)::text')).rows.map(r => r.row);
    assert.deepEqual(actual, expected);
    assert.equal(actual.length, manifest.tables.find(t => t.table === table.name).rows);
    restoredRows += actual.length;
    const info = (await db.query("select c.relrowsecurity as rls,c.relforcerowsecurity as force_rls,pg_get_userbyid(c.relowner) as owner from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=$1", [table.name])).rows[0];
    assert.deepEqual(info, { rls: table.rls, force_rls: table.force_rls, owner: table.owner });
    const actualAcl = (await db.query("select case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee,a.privilege_type as privilege,a.is_grantable as grantable from pg_class c join pg_namespace n on n.oid=c.relnamespace cross join lateral aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a where n.nspname='public' and c.relname=$1", [table.name])).rows;
    assert.deepEqual(normalize(acl(actualAcl)), normalize(acl(table.acl)));
    const policies = (await db.query("select p.polname as name,p.polcmd as cmd,p.polpermissive as permissive,(select jsonb_agg(case when r=0 then 'public' else pg_get_userbyid(r) end order by r) from unnest(p.polroles) r) as roles,pg_get_expr(p.polqual,p.polrelid) as using,pg_get_expr(p.polwithcheck,p.polrelid) as check from pg_policy p join pg_class c on c.oid=p.polrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relname=$1 order by p.polname", [table.name])).rows;
    const policyShape = p => ({ name:p.name, cmd:p.cmd, permissive:p.permissive, roles:p.roles, using:p.using, check:p.check });
    assert.deepEqual(policies.map(policyShape), table.policies.map(policyShape));
  }
  stage = 'functions_and_constraints';
  for (const f of snapshot.functions) {
    const result = (await db.query("select pg_get_functiondef(p.oid) as definition,pg_get_userbyid(p.proowner) as owner from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and format('%I(%s)',p.proname,pg_get_function_identity_arguments(p.oid))=$1", [f.identity])).rows[0];
    assert.equal(result.owner, f.owner);
    assert.equal(result.definition, f.definition);
    const actualAcl = (await db.query("select case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee,a.privilege_type as privilege,a.is_grantable as grantable from pg_proc p join pg_namespace n on n.oid=p.pronamespace cross join lateral aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where n.nspname='public' and format('%I(%s)',p.proname,pg_get_function_identity_arguments(p.oid))=$1", [f.identity])).rows;
    assert.deepEqual(normalize(acl(actualAcl)), normalize(acl(f.acl)));
  }
  const constraints = await scalar("select count(*) n from pg_constraint k join pg_class c on c.oid=k.conrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and k.contype<>'n'");
  const indexes = await scalar("select count(*) n from pg_indexes where schemaname='public'");
  const triggers = await scalar("select count(*) n from pg_trigger t join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and not t.tgisinternal");
  assert.equal(constraints, snapshot.tables.reduce((n,t) => n + t.constraints.length, 0));
  assert.equal(indexes, snapshot.tables.reduce((n,t) => n + t.indexes.length + t.constraints.filter(c => ['p','u','x'].includes(c.kind)).length, 0));
  assert.equal(triggers, snapshot.tables.reduce((n,t) => n + t.triggers.length, 0));
  stage = 'schema_and_default_privileges';
  const schemaAcl = (await db.query("select case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end as grantee,a.privilege_type as privilege,a.is_grantable as grantable from pg_namespace n cross join lateral aclexplode(coalesce(n.nspacl,acldefault('n',n.nspowner))) a where n.nspname='public'")).rows;
  assert.deepEqual(normalize(acl(schemaAcl)), normalize(acl(snapshot.schema_acl)));
  const defaultAcls = (await db.query("select pg_get_userbyid(d.defaclrole) as role,case when d.defaclnamespace=0 then null else n.nspname end as schema,d.defaclobjtype as type,(select jsonb_agg(jsonb_build_object('grantee',case when a.grantee=0 then 'PUBLIC' else pg_get_userbyid(a.grantee) end,'privilege',a.privilege_type,'grantable',a.is_grantable) order by a.grantee,a.privilege_type) from aclexplode(d.defaclacl) a) as entries from pg_default_acl d left join pg_namespace n on n.oid=d.defaclnamespace where d.defaclnamespace=0 or n.nspname='public'")).rows;
  const defaultShape = d => ({ role:d.role, schema:d.schema, type:d.type, entries:normalize(acl(d.entries)) });
  assert.deepEqual(normalize(defaultAcls.map(defaultShape)), normalize(snapshot.default_acls.map(defaultShape)));
  stage = 'role_memberships';
  const memberships = (await db.query("select r.rolname as role,m.rolname as member,a.admin_option as admin,a.inherit_option as inherit,a.set_option as set from pg_auth_members a join pg_roles r on r.oid=a.roleid join pg_roles m on m.oid=a.member where r.rolname like 'tradikom_%' and m.rolname like 'tradikom_%' order by r.rolname,m.rolname")).rows;
  const shape = m => ({ role:m.role, member:m.member, admin:m.admin, inherit:m.inherit, set:m.set });
  assert.deepEqual(memberships.map(shape), snapshot.memberships.map(shape));
  for (const role of snapshot.roles.filter(r => r.name.startsWith('tradikom_'))) {
    const actual = (await db.query('select rolinherit,rolsuper,rolbypassrls,rolcanlogin,coalesce(to_jsonb(rolconfig),\'[]\'::jsonb) as config from pg_roles where rolname=$1', [role.name])).rows[0];
    assert.deepEqual(actual, { rolinherit:role.inherit, rolsuper:false, rolbypassrls:false, rolcanlogin:false, config:role.config });
  }
  stage = 'restricted_role';
  const owner = (await db.query("select user_id,tenant_id from memberships where role='owner' order by tenant_id limit 1")).rows[0];
  assert.ok(owner, 'Owner fixture required for this restore qualification');
  await db.exec('set session authorization tradikom_web_preview');
  const runtime = (await db.query('select current_user as name,rolsuper,rolbypassrls from pg_roles where rolname=current_user')).rows[0];
  assert.deepEqual(runtime, { name:'tradikom_web_preview', rolsuper:false, rolbypassrls:false });
  let ownerDenied = false;
  try { await db.exec('set role tradikom_owner'); } catch (e) { ownerDenied = e.code === '42501'; }
  assert.ok(ownerDenied);
  assert.equal(await scalar('select count(*) n from memberships'), 0);
  await db.exec('begin');
  await db.query("select set_config('app.tenant_id',$1,true),set_config('app.actor_id',$2,true)", [owner.tenant_id, owner.user_id]);
  assert.equal(await scalar('select count(*) n from memberships where tenant_id=app_current_tenant_id()'), 1);
  assert.equal(await scalar('select count(*) n from business_profiles where tenant_id=app_current_tenant_id()'), 1);
  await db.exec('commit');
  assert.equal(await scalar('select count(*) n from memberships'), 0);
  await db.exec('begin');
  await db.query("select set_config('app.tenant_id','restore-unrelated-tenant',true),set_config('app.actor_id',$1,true)", [owner.user_id]);
  assert.equal(await scalar('select count(*) n from business_profiles'), 0);
  await db.exec('rollback; reset session authorization');
  const proof = { verifiedAt:new Date().toISOString(), capturedAt:snapshot.captured_at,
    engine:(await db.query('show server_version')).rows[0].server_version,
    restoredTables:snapshot.tables.length, restoredRows, constraints, indexes, triggers,
    policies:snapshot.tables.reduce((n,t) => n + t.policies.length, 0),
    functions:snapshot.functions.length, allRowsExact:true, migrationJournalExact:true,
    tableOwnersRlsPoliciesAndAclsExact:true, functionDefinitionsOwnersAndAclsExact:true,
    schemaAndDefaultPrivilegesExact:true, restoredCustomRolesWithoutLoginOrBypass:true,
    roleMembershipsExact:true, restrictedRoleAndContextReset:true,
    scope:'public application schema only; no platform restore or target engine qualification' };
  fs.writeFileSync(path.join(root, 'verification.json'), JSON.stringify(proof, null, 2), { mode:0o600, flag:'wx' });
  console.log(JSON.stringify(proof));
} catch (error) {
  console.error(JSON.stringify({ failedStage:stage, code:error.code ?? 'ASSERTION_FAILED' }));
  process.exitCode = 1;
} finally {
  await db.close();
}
