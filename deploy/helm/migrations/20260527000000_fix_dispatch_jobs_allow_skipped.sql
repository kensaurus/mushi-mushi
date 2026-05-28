-- ============================================================================
-- Allow fix_dispatch_jobs.status = 'skipped'
-- ============================================================================
-- Root cause (discovered 2026-05-27):
--   The fix-worker writes `status='skipped'` in three paths (lines 341, 379,
--   582 of fix-worker/index.ts) but the original CHECK constraint only allows
--   queued|running|completed|failed|cancelled. Every skip path therefore raised
--   a 23514 check_violation at the DB, the UPDATE was silently rolled back, and
--   the dispatch job stayed perpetually in 'running' state. The SSE stream
--   would time-out without a terminal event, leaving the UI stuck on "Queued"
--   forever. fix_attempts still got its skipped_* status (no constraint there),
--   creating an inconsistent pair: dispatch job = running, fix attempt = skipped.
--
-- Fix: drop the generated constraint and recreate it with 'skipped' added.
--      The constraint name matches PostgreSQL's auto-naming convention for
--      inline CHECK constraints: <table>_<column>_check.
--
-- Backfill: mark stuck 'running' rows (no finished_at, started >1 hr ago)
--           as 'failed' so the SSE poll stops and users can retry.

ALTER TABLE fix_dispatch_jobs
  DROP CONSTRAINT IF EXISTS fix_dispatch_jobs_status_check;

ALTER TABLE fix_dispatch_jobs
  ADD CONSTRAINT fix_dispatch_jobs_status_check
  CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled', 'skipped'));

-- Also update the partial index so 'skipped' jobs are not counted as
-- in-flight by the ALREADY_DISPATCHED guard. Skipped jobs can be re-dispatched.
DROP INDEX IF EXISTS idx_fix_dispatch_status;

CREATE INDEX IF NOT EXISTS idx_fix_dispatch_status
  ON fix_dispatch_jobs (status, created_at)
  WHERE status IN ('queued', 'running');

-- One-time backfill: rows stuck in 'running' with no finish timestamp and
-- started >1 hour ago are almost certainly casualties of the check_violation.
-- They can never recover on their own, so mark them 'failed' with the
-- diagnostic. Idempotent: already-failed/completed rows are unaffected.
UPDATE fix_dispatch_jobs
SET
  status     = 'failed',
  error      = COALESCE(error, 'Stuck in running state — suspected 23514 check_violation on previous skipped write. Resubmit via Dispatch.'),
  finished_at = COALESCE(finished_at, now())
WHERE status = 'running'
  AND finished_at IS NULL
  AND started_at < now() - interval '1 hour';
