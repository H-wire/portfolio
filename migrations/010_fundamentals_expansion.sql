alter table fundamentals_ttm
  add column if not exists revenue_ttm numeric,
  add column if not exists ebitda_ttm numeric,
  add column if not exists net_income_ttm numeric,
  add column if not exists income_tax_expense_ttm numeric,
  add column if not exists capital_expenditure_ttm numeric,
  add column if not exists shares_outstanding numeric;

alter table prices_eod
  add column if not exists adj_close numeric;

create table if not exists dividends (
  id serial primary key,
  listing_id int not null references listings(id) on delete cascade,
  date date not null,
  dividend numeric not null,
  currency text,
  raw jsonb not null default '{}'::jsonb,
  source text not null,
  created_at timestamptz not null default now(),
  unique (listing_id, date)
);

create index if not exists dividends_listing_date_idx
  on dividends (listing_id, date desc);

create table if not exists stock_splits (
  id serial primary key,
  listing_id int not null references listings(id) on delete cascade,
  date date not null,
  numerator numeric not null,
  denominator numeric not null,
  raw jsonb not null default '{}'::jsonb,
  source text not null,
  created_at timestamptz not null default now(),
  unique (listing_id, date)
);

create index if not exists stock_splits_listing_date_idx
  on stock_splits (listing_id, date desc);
