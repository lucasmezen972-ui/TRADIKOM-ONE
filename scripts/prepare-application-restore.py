#!/usr/bin/env python3
"""Build a private restore kit from export-application-snapshot.sql's JSON.

Only supports the schema features explicitly inventoried by that query.
Run against a new, isolated PostgreSQL database as its administrator.
No role passwords or platform data are restored. Encrypt the kit off site.
"""
import hashlib
import csv
import json
import os
from pathlib import Path
import sys
import xml.etree.ElementTree as ET


def qi(value):
    return '"' + value.replace('"', '""') + '"'


def literal(value):
    return "'" + value.replace("'", "''") + "'"


def canonical(rows):
    return json.dumps(rows, sort_keys=True, separators=(',', ':'), ensure_ascii=False)


def prepare(snapshot, target):
    if snapshot.get('format_version') != 1:
        raise ValueError('Unsupported snapshot format')
    if any(snapshot['unsupported'].values()):
        raise ValueError('Unsupported schema features: export with pg_dump instead')
    tables, functions = snapshot['tables'], snapshot['functions'] or []
    if len({t['name'] for t in tables}) != len(tables):
        raise ValueError('Duplicate table names')
    roles = {r['name'] for r in snapshot['roles']}
    for obj in tables + functions:
        roles.add(obj['owner'])
        roles.update(a['grantee'] for a in obj['acl'] or [])
    roles.update(a['grantee'] for a in snapshot['schema_acl'])
    for d in snapshot['default_acls'] or []:
        roles.add(d['role'])
        roles.update(a['grantee'] for a in d['entries'] or [])
    roles.discard('PUBLIC')
    parts = ['BEGIN;', 'SET check_function_bodies=false;']
    # Fail on nonempty target instead of merging with existing application rows.
    parts.append("DO $$ BEGIN IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public') THEN RAISE EXCEPTION 'Restore requires an empty public schema'; END IF; END $$;")
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
                    schemas = next(csv.reader([value], skipinitialspace=True))
                    setting_sql = ', '.join(qi(schema) for schema in schemas)
                elif name in ('statement_timeout', 'idle_in_transaction_session_timeout'):
                    setting_sql = literal(value)
                else:
                    raise ValueError('Unsupported custom role setting')
                parts.append('ALTER ROLE '+qi(r['name'])+' SET '+qi(name)+' TO '+setting_sql+';')
    for m in snapshot['memberships']:
        parts.append('GRANT '+qi(m['role'])+' TO '+qi(m['member'])+' WITH ADMIN '+str(m['admin']).upper()+', INHERIT '+str(m['inherit']).upper()+', SET '+str(m['set']).upper()+';')
    for t in tables:
        columns = []
        for c in t['columns']:
            if c['identity'] or c['generated']:
                raise ValueError('Generated columns unsupported')
            columns.append(qi(c['name'])+' '+c['type']+(' DEFAULT '+c['default'] if c['default'] else '')+(' NOT NULL' if c['notnull'] else ''))
        parts.append('CREATE TABLE public.'+qi(t['name'])+' ('+',\n'.join(columns)+');')
    for f in functions:
        parts.append(f['definition']+';')
    manifest = []
    for t in tables:
        payload = ET.fromstring(t['data_xml']).find('.//payload').text or '[]'
        rows = json.loads(payload)
        encoded = canonical(rows).encode()
        manifest.append({'table':t['name'], 'rows':len(rows), 'sha256':hashlib.sha256(encoded).hexdigest()})
        if rows:
            tag = '$backup_'+hashlib.sha256(payload.encode()).hexdigest()[:16]+'$'
            if tag in payload:
                raise ValueError('SQL delimiter collision')
            parts.append('INSERT INTO public.'+qi(t['name'])+' SELECT * FROM json_populate_recordset(NULL::public.'+qi(t['name'])+', '+tag+payload+tag+'::json);')
    for t in tables:
        parts.extend(i+';' for i in t['indexes'])
    for foreign in (False, True):
        for t in tables:
            for c in t['constraints']:
                if (c['kind']=='f') == foreign:
                    parts.append('ALTER TABLE public.'+qi(t['name'])+' ADD CONSTRAINT '+qi(c['name'])+' '+c['definition']+';')
    for t in tables:
        parts.extend(i+';' for i in t['triggers'])
        for p in t['policies']:
            command = {'*':'ALL','r':'SELECT','a':'INSERT','w':'UPDATE','d':'DELETE'}[p['cmd']]
            parts.append('CREATE POLICY '+qi(p['name'])+' ON public.'+qi(t['name'])+' AS '+('PERMISSIVE' if p['permissive'] else 'RESTRICTIVE')+' FOR '+command+' TO '+', '.join('PUBLIC' if r=='public' else qi(r) for r in p['roles'])+(' USING ('+p['using']+')' if p['using'] else '')+(' WITH CHECK ('+p['check']+')' if p['check'] else '')+';')
        if t['rls']:
            parts.append('ALTER TABLE public.'+qi(t['name'])+' ENABLE ROW LEVEL SECURITY;')
        if t['force_rls']:
            parts.append('ALTER TABLE public.'+qi(t['name'])+' FORCE ROW LEVEL SECURITY;')
        parts.append('ALTER TABLE public.'+qi(t['name'])+' OWNER TO '+qi(t['owner'])+';')
        parts.append('REVOKE ALL ON TABLE public.'+qi(t['name'])+' FROM PUBLIC, '+', '.join(qi(r) for r in sorted(roles))+';')
        for a in t['acl'] or []:
            parts.append('GRANT '+a['privilege']+' ON TABLE public.'+qi(t['name'])+' TO '+('PUBLIC' if a['grantee']=='PUBLIC' else qi(a['grantee']))+(' WITH GRANT OPTION' if a['grantable'] else '')+';')
    for f in functions:
        parts.append('ALTER FUNCTION public.'+f['identity']+' OWNER TO '+qi(f['owner'])+';')
        parts.append('REVOKE ALL ON FUNCTION public.'+f['identity']+' FROM PUBLIC, '+', '.join(qi(r) for r in sorted(roles))+';')
        for a in f['acl'] or []:
            parts.append('GRANT '+a['privilege']+' ON FUNCTION public.'+f['identity']+' TO '+('PUBLIC' if a['grantee']=='PUBLIC' else qi(a['grantee']))+(' WITH GRANT OPTION' if a['grantable'] else '')+';')
    objects = {'r':'TABLES','f':'FUNCTIONS','S':'SEQUENCES'}
    for d in snapshot['default_acls'] or []:
        prefix = 'ALTER DEFAULT PRIVILEGES FOR ROLE '+qi(d['role'])+(' IN SCHEMA '+qi(d['schema']) if d['schema'] else '')+' '
        parts.append(prefix+'REVOKE ALL ON '+objects[d['type']]+' FROM PUBLIC, '+', '.join(qi(r) for r in sorted(roles))+';')
        for a in d['entries'] or []:
            parts.append(prefix+'GRANT '+a['privilege']+' ON '+objects[d['type']]+' TO '+('PUBLIC' if a['grantee']=='PUBLIC' else qi(a['grantee']))+(' WITH GRANT OPTION' if a['grantable'] else '')+';')
    parts.append('REVOKE ALL ON SCHEMA public FROM PUBLIC, '+', '.join(qi(r) for r in sorted(roles))+';')
    for a in snapshot['schema_acl']:
        parts.append('GRANT '+a['privilege']+' ON SCHEMA public TO '+('PUBLIC' if a['grantee']=='PUBLIC' else qi(a['grantee']))+(' WITH GRANT OPTION' if a['grantable'] else '')+';')
    parts.append('COMMIT;')
    target.mkdir(mode=0o700, parents=True, exist_ok=False)
    (target/'restore_application.sql').write_text('\n'.join(parts), encoding='utf8')
    (target/'snapshot.json').write_text(json.dumps(snapshot, ensure_ascii=False), encoding='utf8')
    (target/'manifest.json').write_text(json.dumps({'scope':snapshot['scope'], 'captured_at':snapshot['captured_at'], 'tables':manifest}, indent=2), encoding='utf8')
    for path in target.iterdir():
        path.chmod(0o600)
    return {'tables':len(tables), 'rows':sum(t['rows'] for t in manifest)}


if __name__ == '__main__':
    os.umask(0o077)
    try:
        print(json.dumps(prepare(json.loads(Path(sys.argv[1]).read_text()), Path(sys.argv[2]))))
    except Exception as error:
        # Avoid echoing data, SQL statements or credentials on failure.
        print('Restore kit preparation failed: '+type(error).__name__, file=sys.stderr)
        sys.exit(1)
