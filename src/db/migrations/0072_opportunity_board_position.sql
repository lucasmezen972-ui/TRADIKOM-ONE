alter table opportunities
  add column if not exists board_position integer;

create index if not exists idx_opportunities_tenant_stage_position
  on opportunities (tenant_id, stage_id, board_position);
