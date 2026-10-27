-- ADR 0032 amendment (2026-10-22): CI-repair follow-ups.
--
-- A "merge" Opus review (ADR 0030) whose PR head fails CI on the code (a
-- non-infra failure in ci_jobs, ADR 0033) now earns one follow-up that asks a
-- new Cursor agent to make CI green without weakening tests. It shares the
-- table, caps and claim logic of the findings follow-ups; `kind` says which
-- one a row is. The worker decides from the review's verdict, so findings
-- follow-ups keep working before this migration; CI repairs are only queued
-- once the column exists (the insert names it).

ALTER TABLE public.fix_review_followups
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'findings';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.fix_review_followups'::regclass
      AND conname = 'fix_review_followups_kind_check'
  ) THEN
    ALTER TABLE public.fix_review_followups
      ADD CONSTRAINT fix_review_followups_kind_check CHECK (kind IN ('findings', 'ci_repair'));
  END IF;
END $$;

COMMENT ON COLUMN public.fix_review_followups.kind IS
  'findings: act on the Opus findings of a fix_first review (ADR 0032). ci_repair: make CI green without weakening tests after a merge review whose head fails CI on the code (ADR 0032 amendment, 2026-10-22).';

-- The CI-repair discovery reads ci_jobs by (project_id, head_sha); the
-- existing idx_ci_jobs_project_head (migration 20261021111344) serves it.
