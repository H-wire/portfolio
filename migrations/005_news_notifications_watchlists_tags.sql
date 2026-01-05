-- News, notifications, watchlists, and tags.

CREATE TABLE IF NOT EXISTS news_items (
  id BIGSERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  title TEXT NOT NULL,
  published_at TIMESTAMPTZ NOT NULL,
  url TEXT NOT NULL,
  summary TEXT NULL,
  raw JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (url)
);

CREATE INDEX IF NOT EXISTS news_items_published_at_idx
  ON news_items(published_at DESC);

CREATE TABLE IF NOT EXISTS news_matches (
  news_id BIGINT NOT NULL REFERENCES news_items(id) ON DELETE CASCADE,
  instrument_id BIGINT NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  confidence NUMERIC NOT NULL,
  PRIMARY KEY (news_id, instrument_id)
);

CREATE TABLE IF NOT EXISTS watchlists (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS watchlists_org_id_idx
  ON watchlists(org_id);

CREATE INDEX IF NOT EXISTS watchlists_user_id_idx
  ON watchlists(user_id);

CREATE TABLE IF NOT EXISTS watchlist_items (
  watchlist_id BIGINT NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
  listing_id BIGINT NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  added_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (watchlist_id, listing_id)
);

CREATE TABLE IF NOT EXISTS tags (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT NULL,
  UNIQUE (org_id, name)
);

CREATE TABLE IF NOT EXISTS instrument_tags (
  tag_id BIGINT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  instrument_id BIGINT NOT NULL REFERENCES instruments(id) ON DELETE CASCADE,
  PRIMARY KEY (tag_id, instrument_id)
);

CREATE TABLE IF NOT EXISTS notification_rules (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT true,
  condition JSONB NOT NULL DEFAULT '{}'::jsonb,
  channel_prefs JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS notifications (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_id BIGINT NULL REFERENCES events(id) ON DELETE SET NULL,
  status TEXT NOT NULL,
  channel TEXT NOT NULL,
  sent_at TIMESTAMPTZ NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS notifications_org_id_idx
  ON notifications(org_id);

CREATE INDEX IF NOT EXISTS notifications_user_id_idx
  ON notifications(user_id);

CREATE INDEX IF NOT EXISTS notifications_event_id_idx
  ON notifications(event_id);

CREATE INDEX IF NOT EXISTS watchlist_items_listing_id_idx
  ON watchlist_items(listing_id);

CREATE INDEX IF NOT EXISTS instrument_tags_instrument_id_idx
  ON instrument_tags(instrument_id);

CREATE INDEX IF NOT EXISTS news_matches_instrument_id_idx
  ON news_matches(instrument_id);
