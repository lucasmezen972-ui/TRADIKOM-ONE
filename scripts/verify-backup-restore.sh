#!/usr/bin/env bash

set -euo pipefail

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required for backup verification." >&2
  exit 1
fi

run_key="${GITHUB_RUN_ID:-$$}"
run_key="${run_key//[^0-9]/}"
source_database="tradikom_backup_source_${run_key}"
restore_database="tradikom_backup_restore_${run_key}"
base_url="${DATABASE_URL%/*}"
source_url="${base_url}/${source_database}"
restore_url="${base_url}/${restore_database}"
backup_directory="$(mktemp -d)"

run_psql() {
  local target_url="$1"
  local sql="$2"
  docker run --rm --network host \
    -e TARGET_DATABASE_URL="$target_url" \
    -e SQL="$sql" \
    postgres:17-alpine \
    sh -c 'psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -c "$SQL"'
}

run_psql_value() {
  local target_url="$1"
  local sql="$2"
  docker run --rm --network host \
    -e TARGET_DATABASE_URL="$target_url" \
    -e SQL="$sql" \
    postgres:17-alpine \
    sh -c 'psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -tA -c "$SQL"'
}

cleanup() {
  run_psql "$DATABASE_URL" \
    "drop database if exists ${source_database} with (force)" >/dev/null || true
  run_psql "$DATABASE_URL" \
    "drop database if exists ${restore_database} with (force)" >/dev/null || true
  rm -rf "$backup_directory"
}
trap cleanup EXIT

run_psql "$DATABASE_URL" "create database ${source_database}" >/dev/null
DATABASE_URL="$source_url" pnpm db:migrate >/dev/null
run_psql "$source_url" \
  "insert into tenants (id, name, slug, category, created_at) values ('backup-probe', 'Backup Probe', 'backup-probe', 'test', '2026-01-01T00:00:00.000Z')" \
  >/dev/null

docker run --rm --network host \
  -e TARGET_DATABASE_URL="$source_url" \
  -v "$backup_directory:/backup" \
  postgres:17-alpine \
  sh -c 'pg_dump "$TARGET_DATABASE_URL" --format=custom --no-owner --no-acl --file=/backup/database.dump'

run_psql "$DATABASE_URL" "create database ${restore_database}" >/dev/null
docker run --rm --network host \
  -e TARGET_DATABASE_URL="$restore_url" \
  -v "$backup_directory:/backup" \
  postgres:17-alpine \
  sh -c 'pg_restore --dbname="$TARGET_DATABASE_URL" --no-owner --no-acl /backup/database.dump'

DATABASE_URL="$restore_url" pnpm db:migrate >/dev/null
probe_count="$(run_psql_value "$restore_url" "select count(*) from tenants where id = 'backup-probe'")"
if [[ "$probe_count" != "1" ]]; then
  echo "Restored database did not preserve the verification record." >&2
  exit 1
fi

echo "Backup and restore verification completed."
