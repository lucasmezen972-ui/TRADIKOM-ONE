#!/usr/bin/env python3
"""Build a private restore kit from export-application-snapshot.sql's JSON.

Supports historical public-only format 1 and public+app_private format 2.
Only supports the schema features explicitly inventoried by that query.
Run against a new, isolated PostgreSQL database as its administrator.
No role passwords or platform data are restored. Encrypt the kit off site.
"""
import hashlib
import csv
import json
import os
from pathlib import Path
import re
import sys
import xml.etree.ElementTree as ET


def qi(value):
    return '"' + value.replace('"', '""') + '"'


def literal(value):
    return "'" + value.replace("'", "''") + "'"


def canonical(rows):
    return json.dumps(rows, sort_keys=True, separators=(',', ':'), ensure_ascii=False)


def prepare(snapshot, target):
    version = snapshot.get('format_version')
    if version not in (1, 2):
        raise ValueError('Unsupported snapshot format')
    if any(snapshot['unsupported'].values()):
        raise ValueError('Unsupported schema features: export with pg_dump instead')
    schemas = ([{'name': 'public', 'owner': None, 'acl': snapshot['schema_acl']}]
               if version == 1 else snapshot['schemas'])
    schema_names = {s['name'] for s in schemas}
    if not schemas or 'public' not in schema_names or len(schema_names) != len(schemas) or not schema_names <= {'public', 'app_private'}:
        raise ValueError('Invalid application schema scope')
    def qualify(obj, field):
        schema = 'public' if version == 1 else obj['schema']
        if schema not in schema_names:
            raise ValueError('Object outside application schema scope')
        return {**obj, 'schema': schema, 'qualified': qi(schema)+'.'+(qi(obj[field]) if field == 'name' else obj[field])}
    tables = [qualify(t, 'name') for t in snapshot['tables'] or []]
    functions = [qualify(f, 'identity') for f in snapshot['functions'] or []]
    for objects in (tables, functions):
        if len({obj['qualified'] for obj in objects}) != len(objects):
            raise ValueError('Duplicate application objects')
    roles = {r['name'] for r in snapshot['roles']}
    for obj in tables + functions:
        roles.add(obj['owner'])
        roles.update(a['grantee'] for a in obj['acl'] or [])
    for schema in schemas:
        if schema['owner']:
            roles.add(schema['owner'])
        roles.update(a['grantee'] for a in schema['acl'] or [])
    for membership in snapshot['memberships']:
        roles.update((membership['role'], membership['member']))
    for table in tables:
        for policy in table['policies']:
            roles.update(role for role in policy['roles'] if role.lower() != 'public')
    for d in snapshot['default_acls'] or []:
        if d['schema'] is not None and d['schema'] not in schema_names:
            raise ValueError('Default privileges outside application scope')
        roles.add(d['role'])
        roles.update(a['grantee'] for a in d['entries'] or [])
    roles.discard('PUBLIC')
    parts = ['BEGIN;', 'SET LOCAL check_function_bodies=false;']
    # This runs before roles or schema metadata are modified. Platform schemas
    # also make a live Supabase database fail this empty, isolated-target guard.
    parts.append("""DO $$ BEGIN
IF EXISTS (SELECT 1 FROM pg_namespace
  WHERE nspname NOT IN ('public','pg_catalog','information_schema') AND nspname !~ '^pg_')
OR EXISTS (SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public')
OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public')
OR EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace WHERE n.nspname='public' AND t.typtype IN ('e','d'))
OR EXISTS (SELECT 1 FROM pg_default_acl)
THEN RAISE EXCEPTION 'Restore requires a new empty isolated database'; END IF; END $$;""")
    new_roles = sorted(role for role in roles if role != 'postgres' and not role.startswith('pg_'))
    if new_roles:
        # Roles are cluster-wide: an empty database in a shared application
        # cluster must not let this kit overwrite an existing runtime identity.
        parts.append('DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname IN ('+', '.join(literal(role) for role in new_roles)+")) THEN RAISE EXCEPTION 'Restore requires fresh isolated application roles'; END IF; END $$;")
    for role in sorted(roles):
        if role in ('postgres', 'pg_database_owner') or role.startswith('pg_'):
            continue
        parts.append(f'DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname={literal(role)}) THEN CREATE ROLE {qi(role)} NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF; END $$;')
    for r in snapshot['roles']:
        if r['name'].startswith('tradikom_'):
            parts.append('ALTER ROLE '+qi(r['name'])+' NOLOGIN NOSUPERUSER NOBYPASSRLS '+('INHERIT' if r['inherit'] else 'NOINHERIT')+';')
            for setting in r['config']:
                name, value = setting.split('=', 1)
                # search_path is an identifier list, not one quoted schema name.
                if name == 'search_path':
                    search_path_schemas = next(csv.reader([value], skipinitialspace=True))
                    setting_sql = (', '.join(qi(schema) for schema in search_path_schemas)
                                   if any(search_path_schemas) else literal(''))
                elif name in ('statement_timeout', 'idle_in_transaction_session_timeout'):
                    setting_sql = literal(value)
                else:
                    raise ValueError('Unsupported custom role setting')
                parts.append('ALTER ROLE '+qi(r['name'])+' SET '+qi(name)+' TO '+setting_sql+';')
    for m in snapshot['memberships']:
        parts.append('GRANT '+qi(m['role'])+' TO '+qi(m['member'])+' WITH ADMIN '+str(m['admin']).upper()+', INHERIT '+str(m['inherit']).upper()+', SET '+str(m['set']).upper()+';')
    for schema in schemas:
        if schema['name'] != 'public':
            parts.append('CREATE SCHEMA '+qi(schema['name'])+';')
    for t in tables:
        columns = []
        for c in t['columns']:
            if c['identity'] or c['generated']:
                raise ValueError('Generated columns unsupported')
            columns.append(qi(c['name'])+' '+c['type']+(' DEFAULT '+c['default'] if c['default'] else '')+(' NOT NULL' if c['notnull'] else ''))
        parts.append('CREATE TABLE '+t['qualified']+' ('+',\n'.join(columns)+');')
    for f in functions:
        parts.append(f['definition']+';')
    # Load application rows AND quota counters while user triggers are absent.
    # Restoring assets through their quota trigger would count them twice.
    manifest = []
    for t in tables:
        payload = ET.fromstring(t['data_xml']).find('.//payload').text or '[]'
        rows = json.loads(payload)
        if not isinstance(rows, list):
            raise ValueError('Invalid table payload')
        if version == 2:
            byte_columns = [c['name'] for c in t['columns'] if c['type'] == 'bytea']
            for row in rows:
                for name in byte_columns:
                    value = row.get(name)
                    if value is not None and (not isinstance(value, str) or re.fullmatch(r'\\x(?:[0-9a-fA-F]{2})*', value) is None):
                        raise ValueError('Format 2 BYTEA must use hex encoding')
        encoded = canonical(rows).encode()
        entry = {'table':t['name'], 'rows':len(rows), 'sha256':hashlib.sha256(encoded).hexdigest()}
        if version == 2:
            entry['schema'] = t['schema']
        manifest.append(entry)
        if rows:
            tag = '$backup_'+hashlib.sha256(payload.encode()).hexdigest()[:16]+'$'
            if tag in payload:
                raise ValueError('SQL delimiter collision')
            parts.append('INSERT INTO '+t['qualified']+' SELECT * FROM json_populate_recordset(NULL::'+t['qualified']+', '+tag+payload+tag+'::json);')
    for t in tables:
        parts.extend(i+';' for i in t['indexes'])
    for foreign in (False, True):
        for t in tables:
            for c in t['constraints']:
                if (c['kind']=='f') == foreign:
                    parts.append('ALTER TABLE '+t['qualified']+' ADD CONSTRAINT '+qi(c['name'])+' '+c['definition']+';')
    for t in tables:
        parts.extend(i+';' for i in t['triggers'])
        for p in t['policies']:
            command = {'*':'ALL','r':'SELECT','a':'INSERT','w':'UPDATE','d':'DELETE'}[p['cmd']]
            parts.append('CREATE POLICY '+qi(p['name'])+' ON '+t['qualified']+' AS '+('PERMISSIVE' if p['permissive'] else 'RESTRICTIVE')+' FOR '+command+' TO '+', '.join('PUBLIC' if r=='public' else qi(r) for r in p['roles'])+(' USING ('+p['using']+')' if p['using'] else '')+(' WITH CHECK ('+p['check']+')' if p['check'] else '')+';')
        if t['rls']:
            parts.append('ALTER TABLE '+t['qualified']+' ENABLE ROW LEVEL SECURITY;')
        if t['force_rls']:
            parts.append('ALTER TABLE '+t['qualified']+' FORCE ROW LEVEL SECURITY;')
        parts.append('ALTER TABLE '+t['qualified']+' OWNER TO '+qi(t['owner'])+';')
        parts.append('REVOKE ALL ON TABLE '+t['qualified']+' FROM PUBLIC, '+', '.join(qi(r) for r in sorted(roles))+';')
        for a in t['acl'] or []:
            parts.append('GRANT '+a['privilege']+' ON TABLE '+t['qualified']+' TO '+('PUBLIC' if a['grantee']=='PUBLIC' else qi(a['grantee']))+(' WITH GRANT OPTION' if a['grantable'] else '')+';')
    for f in functions:
        parts.append('ALTER FUNCTION '+f['qualified']+' OWNER TO '+qi(f['owner'])+';')
        parts.append('REVOKE ALL ON FUNCTION '+f['qualified']+' FROM PUBLIC, '+', '.join(qi(r) for r in sorted(roles))+';')
        for a in f['acl'] or []:
            parts.append('GRANT '+a['privilege']+' ON FUNCTION '+f['qualified']+' TO '+('PUBLIC' if a['grantee']=='PUBLIC' else qi(a['grantee']))+(' WITH GRANT OPTION' if a['grantable'] else '')+';')
    objects = {'r':'TABLES','f':'FUNCTIONS','S':'SEQUENCES','T':'TYPES','n':'SCHEMAS'}
    for d in snapshot['default_acls'] or []:
        prefix = 'ALTER DEFAULT PRIVILEGES FOR ROLE '+qi(d['role'])+(' IN SCHEMA '+qi(d['schema']) if d['schema'] else '')+' '
        parts.append(prefix+'REVOKE ALL ON '+objects[d['type']]+' FROM PUBLIC, '+', '.join(qi(r) for r in sorted(roles))+';')
        for a in d['entries'] or []:
            parts.append(prefix+'GRANT '+a['privilege']+' ON '+objects[d['type']]+' TO '+('PUBLIC' if a['grantee']=='PUBLIC' else qi(a['grantee']))+(' WITH GRANT OPTION' if a['grantable'] else '')+';')
    for schema in schemas:
        name = qi(schema['name'])
        if schema['owner']:
            parts.append('ALTER SCHEMA '+name+' OWNER TO '+qi(schema['owner'])+';')
        parts.append('REVOKE ALL ON SCHEMA '+name+' FROM PUBLIC, '+', '.join(qi(r) for r in sorted(roles))+';')
        for a in schema['acl'] or []:
            parts.append('GRANT '+a['privilege']+' ON SCHEMA '+name+' TO '+('PUBLIC' if a['grantee']=='PUBLIC' else qi(a['grantee']))+(' WITH GRANT OPTION' if a['grantable'] else '')+';')
    parts.append('COMMIT;')
    target.mkdir(mode=0o700, parents=True, exist_ok=False)
    (target/'restore_application.sql').write_text('\n'.join(parts), encoding='utf8')
    (target/'snapshot.json').write_text(json.dumps(snapshot, ensure_ascii=False), encoding='utf8')
    (target/'manifest.json').write_text(json.dumps({'format_version':version, 'scope':snapshot['scope'], 'captured_at':snapshot['captured_at'], 'tables':manifest}, indent=2), encoding='utf8')
    for path in target.iterdir():
        path.chmod(0o600)
    return {'format_version':version, 'tables':len(tables), 'rows':sum(t['rows'] for t in manifest)}


if __name__ == '__main__':
    os.umask(0o077)
    try:
        print(json.dumps(prepare(json.loads(Path(sys.argv[1]).read_text()), Path(sys.argv[2]))))
    except Exception as error:
        # Avoid echoing data, SQL statements or credentials on failure.
        print('Restore kit preparation failed: '+type(error).__name__, file=sys.stderr)
        sys.exit(1)
