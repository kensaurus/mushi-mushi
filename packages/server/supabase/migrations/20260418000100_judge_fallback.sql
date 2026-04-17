-- M2 (Wave A v0.6.0): judge-batch OpenAI fallback
-- Adds per-project fallback configuration and a flag tracking when the
-- fallback path was actually used (for cost attribution + provider-health
-- dashboards).

ALTER TABLE project_settings
  ADD COLUMN IF NOT EXISTS judge_fallback_provider TEXT
    DEFAULT 'openai'
    CHECK (judge_fallback_provider IN ('openai', 'none')),
  ADD COLUMN IF NOT EXISTS judge_fallback_model TEXT
    DEFAULT 'gpt-4.1';

ALTER TABLE classification_evaluations
  ADD COLUMN IF NOT EXISTS judge_fallback_used boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_classification_evals_fallback
  ON classification_evaluations (project_id, created_at DESC)
  WHERE judge_fallback_used IS TRUE;

COMMENT ON COLUMN project_settings.judge_fallback_provider IS
  'V5.3 §2.7: Provider used when the primary judge (Anthropic) errors. ''none'' disables fallback.';
COMMENT ON COLUMN project_settings.judge_fallback_model IS
  'V5.3 §2.7: Model id passed to the fallback provider.';
COMMENT ON COLUMN classification_evaluations.judge_fallback_used IS
  'V5.3 §2.7: True when the OpenAI fallback path produced this evaluation.';
