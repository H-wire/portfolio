create table if not exists fundamentals_ttm (
  id serial primary key,
  instrument_id int not null references instruments(id) on delete cascade,
  as_of_date date not null,
  eps_ttm numeric,
  operating_cashflow_ttm numeric,
  ebit_ttm numeric,
  tax_rate numeric,
  total_debt numeric,
  total_equity numeric,
  cash_and_equivalents numeric,
  raw jsonb not null,
  source text not null,
  created_at timestamptz not null default now(),
  unique (instrument_id, as_of_date, source)
);

create index if not exists fundamentals_ttm_instrument_idx
  on fundamentals_ttm (instrument_id, as_of_date desc);

create table if not exists factor_scores (
  id serial primary key,
  org_id int not null references orgs(id) on delete cascade,
  portfolio_id int not null references portfolios(id) on delete cascade,
  listing_id int not null references listings(id) on delete cascade,
  instrument_id int not null references instruments(id) on delete cascade,
  as_of_date date not null,
  quality_score numeric,
  trend_score numeric,
  rs_score numeric,
  timing_score numeric,
  vol_score numeric,
  total_score numeric,
  passed_quality_filter boolean not null default false,
  passed_trend_filter boolean not null default false,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (org_id, portfolio_id, listing_id, as_of_date)
);

create index if not exists factor_scores_portfolio_date_idx
  on factor_scores (org_id, portfolio_id, as_of_date desc);

create table if not exists recommendations (
  id serial primary key,
  org_id int not null references orgs(id) on delete cascade,
  portfolio_id int not null references portfolios(id) on delete cascade,
  as_of_month text not null,
  risk_level int not null,
  top_n int not null,
  items jsonb not null,
  created_at timestamptz not null default now(),
  unique (org_id, portfolio_id, as_of_month, risk_level)
);

create index if not exists recommendations_portfolio_month_idx
  on recommendations (org_id, portfolio_id, as_of_month desc);
