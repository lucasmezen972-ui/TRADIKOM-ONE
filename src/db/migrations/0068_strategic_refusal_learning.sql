alter table strategic_recommendations
  add column if not exists mute_lifted_at text;

alter table strategic_recommendations
  add column if not exists mute_lifted_by text references users(id);

alter table strategic_recommendations
  drop constraint if exists strategic_recommendations_mute_lift_pairing;

alter table strategic_recommendations
  add constraint strategic_recommendations_mute_lift_pairing
  check (
    (mute_lifted_at is null and mute_lifted_by is null)
    or (mute_lifted_at is not null and mute_lifted_by is not null)
  );

create index if not exists idx_strategic_recommendations_tenant_rule_decided
  on strategic_recommendations (tenant_id, rule_key, decided_at desc);
