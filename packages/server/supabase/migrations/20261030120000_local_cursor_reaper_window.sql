-- =============================================================================
-- Migration: local_cursor_reaper_window
-- =============================================================================
-- Replaces fix_attempts_stuck_reaper so a mushi work row stored as
-- agent 'local-cursor' gets the same 90 minute window as agent 'mcp'
-- (submit_fix_result and older mushi work rows). A 30 minute reap would
-- mark a live local run dead. No column changes.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.fix_attempts_stuck_reaper()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_jobs    integer := 0;
  v_queued  integer := 0;
  v_count   integer := 0;
BEGIN
  -- 1. In-edge jobs whose worker stopped. A job with no attempt never reached
  --    a cloud agent, so it is in-edge by definition. Anything handed to work
  --    that outlives the worker is left alone: a cloud agent kind, or an
  --    attempt carrying an external run reference (Cursor agent, GitHub
  --    task, Claude Actions run, generic external ref) — agent-status-poll
  --    and the vendors' callbacks own those.
  WITH dead AS (
    SELECT j.id
    FROM   public.fix_dispatch_jobs j
    LEFT   JOIN public.fix_attempts fa ON fa.id = j.fix_attempt_id
    WHERE  j.status = 'running'
      AND  COALESCE(j.started_at, j.created_at) < now() - interval '30 minutes'
      AND  (
             fa.id IS NULL
          OR (    COALESCE(fa.agent, '') NOT IN ('cursor_cloud', 'github_cloud_agent', 'anthropic_managed')
              AND fa.cursor_agent_id IS NULL
              AND fa.github_task_id IS NULL
              AND fa.claude_dispatch_event_id IS NULL
              AND fa.claude_workflow_run_id IS NULL
              AND fa.external_agent_ref IS NULL)
           )
    FOR UPDATE OF j SKIP LOCKED
  )
  UPDATE public.fix_dispatch_jobs j
  SET    status = 'failed',
         error = 'Reaped: the fix worker stopped mid-run (no result after 30 min). Safe to re-dispatch.',
         finished_at = now()
  FROM   dead
  WHERE  j.id = dead.id;
  GET DIAGNOSTICS v_jobs = ROW_COUNT;

  -- 2. Jobs the sweeper has re-sent for an hour without any worker starting them.
  WITH never AS (
    SELECT j.id
    FROM   public.fix_dispatch_jobs j
    WHERE  j.status = 'queued'
      AND  j.created_at < now() - interval '60 minutes'
    FOR UPDATE OF j SKIP LOCKED
  )
  UPDATE public.fix_dispatch_jobs j
  SET    status = 'failed',
         error = 'Reaped: no fix worker picked this job up within 60 min. Safe to re-dispatch.',
         finished_at = now()
  FROM   never
  WHERE  j.id = never.id;
  GET DIAGNOSTICS v_queued = ROW_COUNT;

  -- 3. Attempts. A local agent attempt ('local-cursor': mushi work; 'mcp':
  --    submit_fix_result and older mushi work rows) runs on someone's machine
  --    for up to about an hour, so it gets 90 minutes; every other attempt
  --    keeps 30.
  WITH stuck AS (
    SELECT fa.id, fa.report_id, (fa.agent IN ('mcp', 'local-cursor')) AS local_run
    FROM   public.fix_attempts fa
    LEFT   JOIN public.fix_dispatch_jobs j ON j.fix_attempt_id = fa.id
    WHERE  fa.status IN ('running', 'queued')
      AND  COALESCE(fa.started_at, fa.created_at) < now() - CASE WHEN fa.agent IN ('mcp', 'local-cursor') THEN interval '90 minutes' ELSE interval '30 minutes' END
      AND  (j.id IS NULL OR j.status NOT IN ('queued', 'running'))
    FOR UPDATE OF fa SKIP LOCKED
  ),
  upd AS (
    UPDATE public.fix_attempts fa
    SET    status = 'failed',
           error = CASE WHEN stuck.local_run
                        THEN 'Reaped: the local agent run (mushi work) sent no result within 90 min; its process stopped. Safe to run again.'
                        ELSE 'Reaped: attempt sat in ''running'' >30 min with no live dispatch job (worker crash or lost invoke). Safe to re-dispatch.'
                   END,
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

  IF v_count + v_jobs + v_queued > 0 THEN
    INSERT INTO public.pipeline_runs (run_name, rows_in, rows_out, rows_blocked, finished_at)
    VALUES ('fix_attempts_stuck_reaper', v_count + v_jobs + v_queued, v_count, v_jobs + v_queued, now());
    RAISE NOTICE 'fix_attempts_stuck_reaper: reaped % attempt(s), % running job(s), % queued job(s)', v_count, v_jobs, v_queued;
  END IF;
END;
$function$;

COMMENT ON FUNCTION public.fix_attempts_stuck_reaper() IS
  'pg_cron worker (every 10 min): fails in-edge fix_dispatch_jobs running >30 min '
  'and jobs queued >60 min, then fails fix_attempts stuck running/queued with no '
  'live dispatch job (>90 min for local agent attempts, agent mcp or local-cursor; >30 min for the '
  'rest), stamps the report processing_error (autofix_blocked) and logs to '
  'pipeline_runs when work was done.';

-- CREATE OR REPLACE keeps the existing ACL (postgres + service_role only);
-- restated so a fresh database matches production.
REVOKE ALL ON FUNCTION public.fix_attempts_stuck_reaper() FROM PUBLIC, anon, authenticated;
