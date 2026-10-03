/*
FILE: 20261003193000_sdk_upgrade_awaiting_lockfile.sql
PURPOSE: Allow sdk_upgrade_jobs.status = 'awaiting_lockfile' (ADR 0019).

OVERVIEW:
- When the host repo has .github/workflows/mushi-sdk-lockfile.yml, the
  runner pushes the @mushi-mushi package bump and parks the job in
  'awaiting_lockfile'. The host workflow refreshes the lockfile; the
  sdk-release-sync cron then opens the PR and moves the job to
  status 'completed' / release_status 'pr_opened' (after 30 min at most).
- The status CHECK was defined once, in 20260615232827_sdk_upgrade_jobs.sql,
  and never altered since. Re-create it with every previous value plus the
  new one, so no existing row can violate it.

NOTES:
- Additive: widens the allowed set only. Safe to re-run (DROP IF EXISTS).
- Apply BEFORE deploying the api, sdk-upgrade-worker and sdk-release-sync
  functions that write the new value.
- The one-active-job unique index (queued/running) is unchanged; the API
  gate treats 'awaiting_lockfile' as active, and sdk-release-sync settles
  every such row within 30-60 min.
*/

ALTER TABLE public.sdk_upgrade_jobs
  DROP CONSTRAINT IF EXISTS sdk_upgrade_jobs_status_check;

ALTER TABLE public.sdk_upgrade_jobs
  ADD CONSTRAINT sdk_upgrade_jobs_status_check
  CHECK (status IN (
    'queued',
    'running',
    'completed',
    'completed_no_pr',
    'failed',
    'cancelled',
    'awaiting_lockfile'
  ));

NOTIFY pgrst, 'reload schema';
