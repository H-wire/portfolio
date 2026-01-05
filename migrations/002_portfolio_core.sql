-- Portfolio, instruments, listings, and pricing tables.

CREATE TABLE IF NOT EXISTS instruments (
  id BIGSERIAL PRIMARY KEY,
  isin TEXT UNIQUE,
  name TEXT NOT NULL,
  asset_type TEXT NOT NULL,
  sector TEXT NULL,
  country TEXT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS exchanges (
  id BIGSERIAL PRIMARY KEY,
  mic_code TEXT UNIQUE,
  name TEXT NOT NULL,
  country TEXT NOT NULL,
  timezone TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS listings (
  id BIGSERIAL PRIMARY KEY,
  instrument_id BIGINT NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  exchange_id BIGINT NOT NULL REFERENCES exchanges(id) ON DELETE CASCADE,
  ticker TEXT NOT NULL,
  currency TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  UNIQUE (exchange_id, ticker)
);

CREATE INDEX IF NOT EXISTS listings_instrument_id_idx
  ON listings(instrument_id);

CREATE INDEX IF NOT EXISTS listings_exchange_id_idx
  ON listings(exchange_id);

CREATE TABLE IF NOT EXISTS portfolios (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  base_currency TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS portfolios_org_id_idx
  ON portfolios(org_id);

CREATE TABLE IF NOT EXISTS accounts (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  account_type TEXT NOT NULL,
  currency TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS accounts_org_id_idx
  ON accounts(org_id);

CREATE TABLE IF NOT EXISTS transactions (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  portfolio_id BIGINT NOT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  account_id BIGINT NULL REFERENCES accounts(id) ON DELETE SET NULL,
  listing_id BIGINT NOT NULL REFERENCES listings(id) ON DELETE RESTRICT,
  trade_date DATE NOT NULL,
  type TEXT NOT NULL,
  quantity NUMERIC NOT NULL,
  price NUMERIC NULL,
  currency TEXT NOT NULL,
  fees NUMERIC NULL,
  notes TEXT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS transactions_org_portfolio_date_idx
  ON transactions(org_id, portfolio_id, trade_date DESC);

CREATE INDEX IF NOT EXISTS transactions_listing_id_idx
  ON transactions(listing_id);

CREATE INDEX IF NOT EXISTS transactions_account_id_idx
  ON transactions(account_id);

CREATE TABLE IF NOT EXISTS prices_eod (
  listing_id BIGINT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  open NUMERIC NOT NULL,
  high NUMERIC NOT NULL,
  low NUMERIC NOT NULL,
  close NUMERIC NOT NULL,
  volume BIGINT NULL,
  PRIMARY KEY (listing_id, date)
);

CREATE TABLE IF NOT EXISTS fx_rates_eod (
  date DATE NOT NULL,
  base_currency TEXT NOT NULL,
  quote_currency TEXT NOT NULL,
  rate NUMERIC NOT NULL,
  PRIMARY KEY (date, base_currency, quote_currency)
);
