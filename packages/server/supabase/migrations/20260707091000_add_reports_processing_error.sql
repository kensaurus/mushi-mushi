-- classify-report's unhandled-error path has written reports.processing_error
-- since Phase 1, but the column was never created — the best-effort update
-- failed silently on every error (schema/code drift, same class as the
-- stage1_prompt_version incident). Create it, and let fast-filter use it to
-- record Stage-2 forwarding failures.

ALTER TABLE reports ADD COLUMN IF NOT EXISTS processing_error text;

COMMENT ON COLUMN reports.processing_error IS
  'Last pipeline processing failure for this report (stage handoff or classification). Cleared implicitly by successful classification writeback.';
