/*
FILE: 20260828100000_sdk_upgrade_jobs_stuck_reaper.sql
PURPOSE: Self-recover sdk_upgrade_jobs left queued/running after a worker crash.

OVERVIEW:
- Unique index sdk_upgrade_jobs_one_active_per_project blocks a second
  enqueue while any row is queued or running.
- A fire-and-forget invoke that dies mid-run left that row running forever.
- Every 10 minutes, fail jobs whose COALESCE(started_at, created_at) is
  older than 30 minutes so the operator (or Bulk panel) can enqueue again.

DEPENDENCIES:
- public.sdk_upgrade_jobs
- public.pipeline_runs (audit breadcrumb; same pattern as fix_attempts_stuck_reaper)
- pg_cron when installed

NOTES:
- 30 min is longer than the runner's 20 min reclaim window so a late
  HTTP retry can still resume the same job before this reaper fires.
*/

CREATE OR REPLACE FUNCTION public.sdk_upgrade_jobs_stuck_reaper()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  WITH stuck AS (
    SELECT id
    FROM   public.sdk_upgrade_jobs
    WHERE  status IN ('queued', 'running')
      AND  COALESCE(started_at, created_at) < now() - interval '30 minutes'
    FOR UPDATE SKIP LOCKED
  ),
  upd AS (
    UPDATE public.sdk_upgrade_jobs j
    SET    status = 'failed',
           finished_at = now(),
           error = 'Reaped: job sat queued/running >30 min (worker crash or lost invoke). Safe to enqueue again.'
    FROM   stuck
    WHERE  j.id = stuck.id
    RETURNING j.id
  )
  SELECT count(*) INTO v_count FROM upd;

  IF v_count > 0 THEN
    INSERT INTO public.pipeline_runs (run_name, rows_in, rows_out, rows_blocked, finished_at)
    VALUES ('sdk_upgrade_jobs_stuck_reaper', v_count, v_count, 0, now());
    RAISE NOTICE 'sdk_upgrade_jobs_stuck_reaper: reaped % job(s)', v_count;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.sdk_upgrade_jobs_stuck_reaper() IS
  'pg_cron worker (every 10 min): fails sdk_upgrade_jobs stuck queued/running '
  '>30 min so the one-active-per-project unique index unblocks a retry.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron not installed; skipping sdk-upgrade-jobs-stuck-reaper schedule';
    RETURN;
  END IF;

  PERFORM cron.unschedule(jobname)
     FROM cron.job
    WHERE jobname = 'sdk-upgrade-jobs-stuck-reaper';

  PERFORM cron.schedule(
    'sdk-upgrade-jobs-stuck-reaper',
    '*/10 * * * *',
    'SELECT public.sdk_upgrade_jobs_stuck_reaper()'
  );
END $$;
