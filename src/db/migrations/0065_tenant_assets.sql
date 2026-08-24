create table if not exists tenant_assets (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  kind text not null check (kind in ('section_image', 'logo')),
  content_type text not null check (
    content_type in ('image/png', 'image/jpeg', 'image/webp')
  ),
  byte_size integer not null check (byte_size > 0),
  checksum text not null check (char_length(checksum) = 64),
  storage_key text not null,
  original_name text not null,
  uploaded_by text not null references users(id),
  created_at text not null,
  unique (tenant_id, id)
);

create index if not exists idx_tenant_assets_tenant_created
  on tenant_assets (tenant_id, created_at desc);
