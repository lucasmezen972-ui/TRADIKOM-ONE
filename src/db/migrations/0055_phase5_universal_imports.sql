create table if not exists products (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  name text not null,
  sku text not null,
  price_cents integer not null default 0,
  active integer not null default 1,
  created_at text not null,
  updated_at text not null,
  unique (tenant_id, id),
  unique (tenant_id, sku),
  check (price_cents >= 0),
  check (active in (0, 1))
);

alter table imports add column if not exists entity_type text not null default 'contacts';
alter table imports add column if not exists format text not null default 'csv';
alter table imports add column if not exists file_name text not null default 'import.csv';
alter table imports add column if not exists content_type text not null default 'text/csv';
alter table imports add column if not exists file_size_bytes integer not null default 0;
alter table imports add column if not exists mapping text not null default '{}';
alter table imports add column if not exists headers text not null default '[]';
alter table imports add column if not exists total_rows integer not null default 0;
alter table imports add column if not exists processed_rows integer not null default 0;
alter table imports add column if not exists created_by text references users(id);
alter table imports add column if not exists validated_at text;
alter table imports add column if not exists completed_at text;
alter table imports add column if not exists rolled_back_at text;
alter table imports add column if not exists cancelled_at text;
alter table imports add column if not exists updated_at text;

alter table import_rows add column if not exists target_id text;
alter table import_rows add column if not exists created_at text;

create unique index if not exists uq_imports_tenant_id_id
  on imports (tenant_id, id);
create index if not exists idx_imports_tenant_status
  on imports (tenant_id, status, created_at desc);
create index if not exists idx_import_rows_tenant_import_status
  on import_rows (tenant_id, import_id, status, row_number);
create index if not exists idx_products_tenant_updated
  on products (tenant_id, updated_at desc);
