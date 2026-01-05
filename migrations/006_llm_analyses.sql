-- LLM analyses cache and audit data.

CREATE TABLE IF NOT EXISTS llm_analyses (
  id BIGSERIAL PRIMARY KEY,
  org_id BIGINT NOT NULL REFERENCES orgs(id) ON DELETE CASCADE,
  entity_type TEXT NOT NULL,
  entity_id BIGINT NOT NULL,
  analysis_type TEXT NOT NULL,
  prompt_template TEXT NOT NULL,
  model_used TEXT NOT NULL,
  input_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  response_text TEXT NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NULL
);

CREATE INDEX IF NOT EXISTS llm_analyses_org_id_idx
  ON llm_analyses(org_id);

CREATE INDEX IF NOT EXISTS llm_analyses_entity_idx
  ON llm_analyses(entity_type, entity_id);

CREATE INDEX IF NOT EXISTS llm_analyses_analysis_type_idx
  ON llm_analyses(analysis_type);
