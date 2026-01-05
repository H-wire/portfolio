-- Strategies, targets, and signals.

CREATE TABLE IF NOT EXISTS strategies (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  definition JSONB NOT NULL DEFAULT '{}'::jsonb,
  version INT NOT NULL DEFAULT 1,
  cooldown_days INT NOT NULL DEFAULT 30,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS strategies_org_id_idx
  ON strategies(org_id);

CREATE TABLE IF NOT EXISTS strategy_targets (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  strategy_id BIGINT NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  portfolio_id BIGINT NULL REFERENCES portfolios(id) ON DELETE CASCADE,
  listing_id BIGINT NULL REFERENCES listings(id) ON DELETE CASCADE,
  priority INT NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS strategy_targets_org_id_idx
  ON strategy_targets(org_id);

CREATE INDEX IF NOT EXISTS strategy_targets_strategy_id_idx
  ON strategy_targets(strategy_id);

CREATE INDEX IF NOT EXISTS strategy_targets_active_idx
  ON strategy_targets(org_id, strategy_id, active)
  WHERE active = true;

CREATE TABLE IF NOT EXISTS signals (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  strategy_id BIGINT NOT NULL REFERENCES strategies(id) ON DELETE CASCADE,
  listing_id BIGINT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  signal_type TEXT NOT NULL,
  score NUMERIC NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (org_id, strategy_id, listing_id, date, signal_type)
);

CREATE INDEX IF NOT EXISTS signals_org_listing_date_idx
  ON signals(org_id, listing_id, date DESC);

CREATE INDEX IF NOT EXISTS signals_org_strategy_date_idx
  ON signals(org_id, strategy_id, date DESC);

CREATE INDEX IF NOT EXISTS strategy_targets_portfolio_id_idx
  ON strategy_targets(portfolio_id);

CREATE INDEX IF NOT EXISTS strategy_targets_listing_id_idx
  ON strategy_targets(listing_id);
