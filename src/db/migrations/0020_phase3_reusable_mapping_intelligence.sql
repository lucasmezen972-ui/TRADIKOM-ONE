alter table api_global_mappings
  add column if not exists promotion_reason text;

create unique index if not exists uq_api_global_mapping_shape
  on api_global_mappings(
    api_product_id,
    source_entity,
    canonical_entity,
    coalesce(source_field, ''),
    coalesce(canonical_field, '')
  );
