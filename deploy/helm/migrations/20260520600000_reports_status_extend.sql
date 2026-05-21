-- Migration: extend reports.status CHECK constraint to include user-facing
-- triage states used by the CLI (`mushi reports triage/resolve`).
--
-- Original constraint (phase0_initial_schema.sql) only contained pipeline-
-- internal states: new/pending/submitted/queued/classified/grouped/fixing/fixed/dismissed.
-- The CLI TriageBody schema adds three user-facing aliases:
--   triaged      — operator has acknowledged and categorised the report
--   in_progress  — a fix is actively being worked on
--   resolved     — the underlying issue has been addressed
--
-- These are intentionally distinct from the pipeline states so operators can
-- triage reports without accidentally resetting pipeline processing.

ALTER TABLE public.reports
  DROP CONSTRAINT IF EXISTS reports_status_check;

ALTER TABLE public.reports
  ADD CONSTRAINT reports_status_check CHECK (
    status IN (
      -- Pipeline-internal states (managed by the classify/fix workers)
      'new', 'pending', 'submitted', 'queued',
      'classified', 'grouped', 'fixing', 'fixed',
      -- Terminal pipeline state
      'dismissed',
      -- User-facing triage states (set by operators via CLI or admin UI)
      'triaged', 'in_progress', 'resolved'
    )
  );

-- Update index to include new user-facing terminal states so the query planner
-- can use it for common "show open reports" filters.
DROP INDEX IF EXISTS public.reports_status_created_at_idx;
CREATE INDEX IF NOT EXISTS reports_status_created_at_idx
  ON public.reports (project_id, status, created_at DESC);
