-- Migration: reports_tester_link
-- PURPOSE: Wave 6 — extends the existing `reports` table with two nullable
--   FK columns that link a report to the tester who submitted it. Existing
--   host-app reports are unaffected (both columns default to NULL).

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS tester_id uuid
    REFERENCES public.mushi_testers(id) ON DELETE SET NULL;

ALTER TABLE public.reports
  ADD COLUMN IF NOT EXISTS tester_submission_id uuid
    REFERENCES public.tester_submissions(id) ON DELETE SET NULL;

-- Index for the reviewer flow: quickly find reports submitted by testers.
CREATE INDEX IF NOT EXISTS idx_reports_tester_id
  ON public.reports (tester_id)
  WHERE tester_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_reports_tester_submission
  ON public.reports (tester_submission_id)
  WHERE tester_submission_id IS NOT NULL;

COMMENT ON COLUMN public.reports.tester_id IS
  'FK to mushi_testers.id. Set when the report was submitted via the '
  'Mushi Bounties tester-submission flow. NULL for all host-SDK reports.';

COMMENT ON COLUMN public.reports.tester_submission_id IS
  'FK to tester_submissions.id. The tester_submissions row is created '
  'atomically with the report ingest; this column is back-patched within '
  'the same transaction by POST /v1/tester/submissions.';
