-- Add error_detail column to pdca_runs so the runner can surface
-- the real LLM error message instead of silently marking runs as failed.
ALTER TABLE pdca_runs ADD COLUMN IF NOT EXISTS error_detail text;
