-- ============================================================================
-- 20261021120000_spend_down_stop_loss
--
-- Spend-down stop-loss (ADR 0028 amendment, 2026-10-21).
--
-- 1. project_settings.spend_down_stop_loss_reset_at: the console's "Resume"
--    on a paused app. The stop-loss ignores spend-down runs dispatched before
--    it, so the app is back in cold start. Per app (not per key): the samples
--    are the app's spend-down runs under any key. NULL = never reset.
-- 2. Indexes for the reads the stop-loss and the scoreboard make on every
--    worker tick and every status request:
--    - a key's spend-down runs by time (scoreboard, today's count);
--    - an app's runs by time (stop-loss samples). The original
--      idx_fix_dispatch_project (20260418000400) is missing on the live
--      project; only a plain (project_id) index exists there.
--
-- ADDITIVE. fix_dispatch_jobs holds a few hundred rows, so plain CREATE INDEX
-- inside the migration transaction is fine. The code reads the column
-- fail-open (no reset) until this is applied; only POST .../resume needs it
-- and answers 503 MIGRATION_PENDING before.
-- ============================================================================

ALTER TABLE public.project_settings
  ADD COLUMN IF NOT EXISTS spend_down_stop_loss_reset_at timestamptz;

COMMENT ON COLUMN public.project_settings.spend_down_stop_loss_reset_at IS
  'Spend-down stop-loss reset (ADR 0028 amendment): runs dispatched before this time are not stop-loss samples, so a paused app returns to cold start. Set by POST /v1/admin/byok/spend-down/projects/:projectId/resume. NULL = never.';

-- Predicate on the expression itself, not `dispatch_metadata ? 'spend_down_key_id'`:
-- the planner proves `(expr) = $1` implies `(expr) IS NOT NULL` (strict
-- operator), but cannot prove it implies the `?` test, so the `?` form would
-- never serve PostgREST's `dispatch_metadata->>spend_down_key_id=eq.…`.
CREATE INDEX IF NOT EXISTS idx_fix_dispatch_jobs_spend_down_key
  ON public.fix_dispatch_jobs ((dispatch_metadata->>'spend_down_key_id'), created_at DESC)
  WHERE (dispatch_metadata->>'spend_down_key_id') IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_fix_dispatch_project
  ON public.fix_dispatch_jobs (project_id, created_at DESC);
