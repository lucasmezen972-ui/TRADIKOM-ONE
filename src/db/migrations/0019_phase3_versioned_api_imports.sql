alter table api_operations
  drop constraint if exists api_operations_api_product_id_operation_key_key;

create unique index if not exists uq_api_operations_product_snapshot_key
  on api_operations(api_product_id, source_snapshot_id, operation_key);
