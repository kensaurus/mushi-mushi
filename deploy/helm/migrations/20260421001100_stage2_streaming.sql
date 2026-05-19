-- =============================================================================
-- Wave S5: stream Stage 2 classification via `streamObject`.
--
-- Adds a `stage2_partial` JSONB column on `reports` that the classify-report
-- Edge Function throttles-writes while the model is still emitting tokens.
-- The admin UI's existing Realtime subscription on `reports` picks those up
-- with zero extra wiring — the user sees category/severity/summary fields
-- populate live instead of sitting on a spinner for ~6s.
--
-- Cleared by the final UPDATE when streaming finishes, so `stage2_partial`
-- being non-null is a reliable "classification in progress" signal.
-- =============================================================================

ALTER TABLE reports
  ADD COLUMN IF NOT EXISTS stage2_partial JSONB;

COMMENT ON COLUMN reports.stage2_partial IS
  'Wave S5 — transient snapshot of Stage 2 classification while streaming. NULL once classification completes or errors.';

-- Partial index lets the admin "in-flight classifications" lens (WHERE
-- stage2_partial IS NOT NULL) run as an index scan instead of a seq scan
-- on a large reports table.
CREATE INDEX IF NOT EXISTS reports_stage2_partial_idx
  ON reports (updated_at DESC)
  WHERE stage2_partial IS NOT NULL;
