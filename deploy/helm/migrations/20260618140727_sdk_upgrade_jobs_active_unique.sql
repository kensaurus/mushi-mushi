-- One active (queued/running) SDK upgrade job per project — prevents concurrent
-- double-clicks from enqueueing duplicate workers that race on branch creation.
-- The API layer also reuses open mushi/sdk-upgrade* PRs before enqueueing.

CREATE UNIQUE INDEX IF NOT EXISTS sdk_upgrade_jobs_one_active_per_project
  ON public.sdk_upgrade_jobs (project_id)
  WHERE status IN ('queued', 'running');

NOTIFY pgrst, 'reload schema';
