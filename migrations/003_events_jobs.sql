-- Events audit log and job tracking tables.

CREATE TABLE IF NOT EXISTS events (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id BIGINT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS events_org_id_occurred_at_idx
  ON events(org_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS events_entity_occurred_at_idx
  ON events(entity_type, entity_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS job_runs (
  id BIGSERIAL PRIMARY KEY,
  job_name TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ NULL,
  duration_ms INT NULL,
  retry_count INT NOT NULL DEFAULT 0,
  error_message TEXT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS job_runs_job_name_idx
  ON job_runs(job_name);

CREATE INDEX IF NOT EXISTS job_runs_status_idx
  ON job_runs(status);

CREATE TABLE IF NOT EXISTS failed_jobs (
  id BIGSERIAL PRIMARY KEY,
  job_name TEXT NOT NULL,
  entity_type TEXT NULL,
  entity_id BIGINT NULL,
  failed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  retry_count INT NOT NULL DEFAULT 0,
  last_error TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  resolved_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS failed_jobs_job_name_idx
  ON failed_jobs(job_name);

CREATE INDEX IF NOT EXISTS failed_jobs_resolved_at_idx
  ON failed_jobs(resolved_at);
