-- =============================================================================
-- V5.3 §2.15 Wave B B4 — fine-tune export → validate → promote pipeline.
--
-- Adds the columns the pipeline needs on top of the existing fine_tuning_jobs
-- table:
--   - export_format        (jsonl_messages | jsonl_classification)
--   - export_storage_path  (S3-style path inside the configured bucket)
--   - export_size_bytes    (sanity check before training)
--   - validation_report    (eval results — accuracy, drift, leakage)
--   - promote_to_stage     (stage1 | stage2; the model slot to swap on accept)
--   - promoted_at          (when the trained model was accepted)
--   - rejected_reason      (if a human or auto-evaluator vetoed promotion)
-- =============================================================================

ALTER TABLE fine_tuning_jobs
  ADD COLUMN IF NOT EXISTS export_format TEXT NOT NULL DEFAULT 'jsonl_classification'
    CHECK (export_format IN ('jsonl_classification', 'jsonl_messages')),
  ADD COLUMN IF NOT EXISTS export_storage_path TEXT,
  ADD COLUMN IF NOT EXISTS export_size_bytes BIGINT,
  ADD COLUMN IF NOT EXISTS validation_report JSONB,
  ADD COLUMN IF NOT EXISTS promote_to_stage TEXT
    CHECK (promote_to_stage IN ('stage1', 'stage2')),
  ADD COLUMN IF NOT EXISTS promoted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS rejected_reason TEXT,
  ADD COLUMN IF NOT EXISTS labelled_judge_only BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS min_confidence NUMERIC(4,3) NOT NULL DEFAULT 0.85,
  ADD COLUMN IF NOT EXISTS sample_window_days INT NOT NULL DEFAULT 30;

ALTER TABLE fine_tuning_jobs
  DROP CONSTRAINT IF EXISTS fine_tuning_jobs_status_check;
ALTER TABLE fine_tuning_jobs
  ADD CONSTRAINT fine_tuning_jobs_status_check CHECK (status IN (
    'pending',        -- awaiting export
    'exporting',      -- snapshotting reports → JSONL
    'exported',       -- export ready, awaiting upstream training
    'training',       -- vendor job in flight
    'trained',        -- vendor finished, awaiting validation
    'validating',     -- running eval over a held-out set
    'validated',      -- eval passed, awaiting human promote
    'promoted',       -- live in project_settings.fine_tuned_*_model
    'rejected',       -- failed validation OR human rejected
    'failed'          -- vendor error
  ));

COMMENT ON COLUMN fine_tuning_jobs.export_format IS
  'V5.3 §2.15 — controls the schema of the JSONL emitted by the export step. jsonl_classification is the V5 default (1-shot prompt + label).';
COMMENT ON COLUMN fine_tuning_jobs.validation_report IS
  'V5.3 §2.15 — accuracy, F1, drift and PII-leakage metrics from the eval step. Required before promote.';
COMMENT ON COLUMN fine_tuning_jobs.promote_to_stage IS
  'V5.3 §2.15 — the project_settings slot to overwrite on promotion: stage1 (fast/cheap) or stage2 (deeper).';
