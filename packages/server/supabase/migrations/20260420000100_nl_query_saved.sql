-- Migration: 20260420000100_nl_query_saved
-- Purpose:   Wave I §5 query polish — let users pin a natural-language
--            question so it shows up in a "Saved" section above the
--            chronological history. Single nullable boolean keeps the
--            existing PostgREST history endpoint shape untouched.

ALTER TABLE nl_query_history
  ADD COLUMN IF NOT EXISTS is_saved boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN nl_query_history.is_saved IS
  'When true, the user has pinned this question. Surfaced in the Query page Saved sidebar so the prompt + last SQL stay one click away.';

-- Partial index — only the small subset of "saved" rows is interesting for
-- the dedicated sidebar query, so a partial index keeps it tiny.
CREATE INDEX IF NOT EXISTS idx_nl_query_history_saved
  ON nl_query_history (user_id, created_at DESC)
  WHERE is_saved = true;
