create table if not exists financial_input_snapshots (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  period_month text not null check (period_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  status text not null check (status in ('current', 'superseded')),
  version integer not null check (version >= 1),
  supersedes_id text,
  monthly_revenue_cents bigint not null check (monthly_revenue_cents >= 0),
  operating_costs_cents bigint not null check (operating_costs_cents >= 0),
  cash_balance_cents bigint not null check (cash_balance_cents >= 0),
  cash_inflows_cents bigint not null check (cash_inflows_cents >= 0),
  cash_outflows_cents bigint not null check (cash_outflows_cents >= 0),
  receivables_cents bigint not null check (receivables_cents >= 0),
  payables_cents bigint not null check (payables_cents >= 0),
  marketing_spend_cents bigint not null check (marketing_spend_cents >= 0),
  sales_spend_cents bigint not null check (sales_spend_cents >= 0),
  website_spend_cents bigint not null check (website_spend_cents >= 0),
  automation_spend_cents bigint not null check (automation_spend_cents >= 0),
  new_customers integer not null check (new_customers >= 0),
  active_customers integer not null check (active_customers >= 0),
  average_lifetime_months integer check (
    average_lifetime_months is null or average_lifetime_months between 0 and 600
  ),
  marketing_attributed_revenue_cents bigint check (
    marketing_attributed_revenue_cents is null or marketing_attributed_revenue_cents >= 0
  ),
  sales_attributed_revenue_cents bigint check (
    sales_attributed_revenue_cents is null or sales_attributed_revenue_cents >= 0
  ),
  website_attributed_revenue_cents bigint check (
    website_attributed_revenue_cents is null or website_attributed_revenue_cents >= 0
  ),
  automation_savings_cents bigint check (
    automation_savings_cents is null or automation_savings_cents >= 0
  ),
  evidence_summary text not null check (char_length(evidence_summary) between 10 and 500),
  recorded_by text not null references users(id),
  created_at text not null,
  unique (tenant_id, id),
  unique (tenant_id, period_month, version),
  foreign key (tenant_id, supersedes_id)
    references financial_input_snapshots(tenant_id, id) on delete restrict
);

create unique index if not exists idx_financial_snapshots_current_period
  on financial_input_snapshots(tenant_id, period_month)
  where status = 'current';

create table if not exists financial_assessments (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  snapshot_id text not null,
  period_month text not null check (period_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  fingerprint text not null check (char_length(fingerprint) = 64),
  status text not null check (status in ('current', 'superseded')),
  version integer not null check (version >= 1),
  supersedes_id text,
  monthly_revenue_cents bigint not null check (monthly_revenue_cents >= 0),
  estimated_profit_cents bigint not null,
  margin_basis_points integer,
  cash_flow_cents bigint not null,
  cash_runway_months integer check (
    cash_runway_months is null or cash_runway_months >= 0
  ),
  customer_lifetime_value_cents bigint check (
    customer_lifetime_value_cents is null or customer_lifetime_value_cents >= 0
  ),
  customer_acquisition_cost_cents bigint check (
    customer_acquisition_cost_cents is null or customer_acquisition_cost_cents >= 0
  ),
  marketing_roi_basis_points integer,
  sales_roi_basis_points integer,
  website_roi_basis_points integer,
  automation_roi_basis_points integer,
  pipeline_value_cents bigint not null check (pipeline_value_cents >= 0),
  weighted_pipeline_value_cents bigint not null check (weighted_pipeline_value_cents >= 0),
  forecast_three_months_cents bigint not null check (forecast_three_months_cents >= 0),
  confidence integer not null check (confidence between 0 and 100),
  rationale text not null check (char_length(rationale) between 20 and 2000),
  limitations text not null check (char_length(limitations) between 20 and 2000),
  recommended_action text not null check (
    char_length(recommended_action) between 20 and 1200
  ),
  generation_version text not null check (char_length(generation_version) <= 80),
  generated_by text not null references users(id),
  created_at text not null,
  updated_at text not null,
  unique (tenant_id, id),
  unique (tenant_id, fingerprint),
  unique (tenant_id, period_month, version),
  foreign key (tenant_id, snapshot_id)
    references financial_input_snapshots(tenant_id, id) on delete restrict,
  foreign key (tenant_id, supersedes_id)
    references financial_assessments(tenant_id, id) on delete restrict
);

create unique index if not exists idx_financial_assessments_current_period
  on financial_assessments(tenant_id, period_month)
  where status = 'current';

create table if not exists financial_assessment_evidence (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  assessment_id text not null,
  evidence_type text not null check (evidence_type in (
    'declared_input', 'crm_pipeline', 'business_brain', 'formula'
  )),
  source_ref text not null check (char_length(source_ref) between 1 and 200),
  label text not null check (char_length(label) between 3 and 160),
  observed_value text not null check (char_length(observed_value) between 1 and 600),
  captured_at text not null,
  created_at text not null,
  unique (tenant_id, id),
  foreign key (tenant_id, assessment_id)
    references financial_assessments(tenant_id, id) on delete cascade
);

create table if not exists financial_alerts (
  id text primary key,
  tenant_id text not null references tenants(id) on delete cascade,
  assessment_id text not null,
  severity text not null check (severity in ('info', 'warning', 'critical')),
  code text not null check (char_length(code) between 3 and 80),
  title text not null check (char_length(title) between 5 and 180),
  explanation text not null check (char_length(explanation) between 20 and 1000),
  action_label text not null check (char_length(action_label) between 3 and 120),
  action_href text not null check (char_length(action_href) between 1 and 300),
  created_at text not null,
  unique (tenant_id, id),
  unique (tenant_id, assessment_id, code),
  foreign key (tenant_id, assessment_id)
    references financial_assessments(tenant_id, id) on delete cascade
);

create index if not exists idx_financial_snapshots_tenant_period
  on financial_input_snapshots(tenant_id, period_month desc, version desc);

create index if not exists idx_financial_assessments_tenant_period
  on financial_assessments(tenant_id, period_month desc, version desc);

create index if not exists idx_financial_evidence_tenant_assessment
  on financial_assessment_evidence(tenant_id, assessment_id, captured_at desc);

create index if not exists idx_financial_alerts_tenant_assessment
  on financial_alerts(tenant_id, assessment_id, severity, created_at desc);
