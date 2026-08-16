-- =============================================================================
-- Migration: fix_attempts_stuck_running_reaper
-- =============================================================================
-- 2026-08-16 triage audit, recommendation #6.
--
-- fix_attempts left in 'running' (worker crash, isolate teardown, or the
-- pre-2026-08-16 approval branch that never closed its attempt) were
-- permanent orphans: the dispatch route's ALREADY_DISPATCHED guard then
-- blocked every redispatch for that report, and the only remedy was the
-- one-time backfill in 20260527000000. This adds a RECURRING reaper:
--   * every 10 minutes, close attempts stuck in 'running'/'queued' >30 min
--     whose dispatch job is gone or already terminal (a live job means the
--     worker may still be going — leave those alone);
--   * stamp the linked report's processing_error ('autofix_blocked: …') so
--     triage surfaces "attempt died, re-dispatch" instead of silence;
--   * emit a pipeline_runs row when anything was reaped.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fix_attempts_stuck_reaper()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer := 0;
BEGIN
  WITH stuck AS (
    SELECT fa.id, fa.report_id
    FROM   public.fix_attempts fa
    LEFT   JOIN public.fix_dispatch_jobs j ON j.fix_attempt_id = fa.id
    WHERE  fa.status IN ('running', 'queued')
      AND  COALESCE(fa.started_at, fa.created_at) < now() - interval '30 minutes'
      AND  (j.id IS NULL OR j.status NOT IN ('queued', 'running'))
    FOR UPDATE OF fa SKIP LOCKED
  ),
  upd AS (
    UPDATE public.fix_attempts fa
    SET    status = 'failed',
           error = 'Reaped: attempt sat in ''running'' >30 min with no live dispatch job (worker crash or lost invoke). Safe to re-dispatch.',
           completed_at = now()
    FROM   stuck
    WHERE  fa.id = stuck.id
    RETURNING stuck.report_id
  ),
  rep AS (
    UPDATE public.reports r
    SET    processing_error = 'autofix_blocked: previous fix attempt died mid-run (reaped after 30 min). Re-dispatch when ready.'
    FROM   upd
    WHERE  r.id = upd.report_id
      AND  r.status NOT IN ('fixed', 'verified', 'dismissed')
    RETURNING r.id
  )
  SELECT count(*) INTO v_count FROM upd;

  IF v_count > 0 THEN
    INSERT INTO public.pipeline_runs (run_name, rows_in, rows_out, rows_blocked, finished_at)
    VALUES ('fix_attempts_stuck_reaper', v_count, v_count, 0, now());
    RAISE NOTICE 'fix_attempts_stuck_reaper: reaped % attempt(s)', v_count;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.fix_attempts_stuck_reaper() IS
  'pg_cron worker (every 10 min): fails fix_attempts stuck running/queued '
  '>30 min with no live dispatch job, stamps the report processing_error '
  '(autofix_blocked) so triage recommends re-dispatch, and logs to '
  'pipeline_runs when work was done.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron not installed; skipping fix-attempts-stuck-reaper schedule';
    RETURN;
  END IF;

  PERFORM cron.unschedule(jobname)
     FROM cron.job
    WHERE jobname = 'fix-attempts-stuck-reaper';

  PERFORM cron.schedule(
    'fix-attempts-stuck-reaper',
    '*/10 * * * *',
    'SELECT public.fix_attempts_stuck_reaper()'
  );
END $$;
