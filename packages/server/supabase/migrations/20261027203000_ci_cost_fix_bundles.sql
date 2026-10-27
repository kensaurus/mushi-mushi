-- CI cost fix bundles (ADR 0047 amendment 2026-10-27, "Apply to every app").
-- Several fixes for one repo (several workflow files and/or kinds) open ONE
-- draft PR, so the repo pays for one CI run instead of one per fix. A bundle
-- is the set of ci_cost_fix_jobs rows sharing a bundle_id: each row is still
-- one workflow file + one kind, keeps its own status, summary and refusal,
-- and every row that made it into the PR carries the same pr_url.
--
-- Per-workflow measurement stays honest: when two kinds change the same file
-- in one PR, only one of the rows stores baseline / measured (the workflow's
-- minutes once), and the other says it is measured together with it.
--
-- Additive: a nullable column and a partial index. The single "Open fix PR"
-- path never reads the column, so it works before and after this migration.
-- RLS is already on (service role only, no anon / authenticated grants).

ALTER TABLE public.ci_cost_fix_jobs
  ADD COLUMN IF NOT EXISTS bundle_id uuid;

CREATE INDEX IF NOT EXISTS ci_cost_fix_jobs_bundle_idx
  ON public.ci_cost_fix_jobs (bundle_id)
  WHERE bundle_id IS NOT NULL;

COMMENT ON COLUMN public.ci_cost_fix_jobs.bundle_id IS
  'Set when the fix was opened together with others for the same repo in one draft PR (POST /v1/admin/ci/cost-fix-bundles). Rows sharing it are claimed and finished together by ci-cost-fix-worker.';

NOTIFY pgrst, 'reload schema';
