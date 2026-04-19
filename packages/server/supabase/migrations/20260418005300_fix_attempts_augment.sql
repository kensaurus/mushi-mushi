-- Migration: 20260418005300_fix_attempts_augment
-- Purpose:   Track Firecrawl auto-augmentation on each fix attempt so the
--            Fixes page / Langfuse deep-link can show "this fix used N web
--            snippets from these URLs."

ALTER TABLE fix_attempts
  ADD COLUMN IF NOT EXISTS augment_trace_id TEXT,
  ADD COLUMN IF NOT EXISTS augment_sources  JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS augment_reason   TEXT
    CHECK (augment_reason IS NULL OR augment_reason IN ('rag_sparse','low_judge_score','manual'));

COMMENT ON COLUMN fix_attempts.augment_trace_id IS
  'Wave E: Langfuse trace id for the firecrawl.search span used to augment this fix.';
COMMENT ON COLUMN fix_attempts.augment_sources IS
  'Wave E: JSON array of {url,title,snippet} entries from Firecrawl injected into the LLM prompt.';
COMMENT ON COLUMN fix_attempts.augment_reason IS
  'Wave E: why the augmentation fired (rag_sparse | low_judge_score | manual).';
