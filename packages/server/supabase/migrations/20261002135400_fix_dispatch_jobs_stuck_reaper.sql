-- =============================================================================
-- Migration: fix_dispatch_jobs_stuck_reaper
-- =============================================================================
-- APPLY ORDER: independent. Replaces one function body; no column changes, no
-- edge function reads anything new. Safe before or after any deploy.
--
-- 2026-10-02 pipeline audit (report 469f6962 trace).
--
-- fix_attempts_stuck_reaper (20260816110000) only closes an attempt whose
-- dispatch job is gone or terminal, and fix_dispatch_sweeper only re-sends
-- 'queued' jobs. So an in-edge fix-worker that died mid-run left BOTH rows in
-- 'running' forever, and the dispatch route's ALREADY_DISPATCHED guard then
-- refused every re-dispatch of that report. A job that never started kept
-- being re-sent every minute by the sweeper, also forever.
--
-- The edge runtime stops a worker after minutes, so this reaper now:
--   1. fails dispatch jobs 'running' > 30 min that belong to an in-edge
--      attempt (claude_code and its aliases rest_worker / rest_fix_worker /
--      llm), or have no attempt at all (the worker died before creating
--      one). Cloud-agent jobs (cursor_cloud, github_cloud_agent,
--      anthropic_managed) and any attempt with an external run reference are
--      left to agent-status-poll (24 h expiry) and the vendor callbacks.
--      codex / mcp never hold a job: the worker stamps them skipped at once;
--   2. fails dispatch jobs still 'queued' after 60 min (the sweeper re-sent
--      them ~60 times; nothing is going to pick them up);
--   3. then reaps attempts exactly as before, which now sees those jobs as
--      terminal. Each step is its own statement so step 3 sees steps 1-2.
--
-- Verification (run after apply; both must return 0 rows after one tick):
--   SELECT id, status, started_at FROM public.fix_dispatch_jobs j
--   WHERE j.status = 'running' AND COALESCE(j.started_at, j.created_at) < now() - interval '40 minutes'
--     AND NOT EXISTS (SELECT 1 FROM public.fix_attempts fa WHERE fa.id = j.fix_attempt_id
--                     AND (fa.agent IN ('cursor_cloud', 'github_cloud_agent', 'anthropic_managed')
--                          OR fa.cursor_agent_id IS NOT NULL OR fa.github_task_id IS NOT NULL
--                          OR fa.claude_dispatch_event_id IS NOT NULL OR fa.claude_workflow_run_id IS NOT NULL
--                          OR fa.external_agent_ref IS NOT NULL));
--   SELECT id FROM public.fix_dispatch_jobs WHERE status = 'queued' AND created_at < now() - interval '70 minutes';
-- And the function body carries the new step:
--   SELECT pg_get_functiondef('public.fix_attempts_stuck_reaper()'::regprocedure) LIKE '%worker stopped%';
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

  -- 3. Attempts, unchanged from 20260816110000.
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

  IF v_count + v_jobs + v_queued > 0 THEN
    INSERT INTO public.pipeline_runs (run_name, rows_in, rows_out, rows_blocked, finished_at)
    VALUES ('fix_attempts_stuck_reaper', v_count + v_jobs + v_queued, v_count, v_jobs + v_queued, now());
    RAISE NOTICE 'fix_attempts_stuck_reaper: reaped % attempt(s), % running job(s), % queued job(s)', v_count, v_jobs, v_queued;
  END IF;
END;
$function$;

COMMENT ON FUNCTION public.fix_attempts_stuck_reaper() IS
  'pg_cron worker (every 10 min): fails in-edge fix_dispatch_jobs running >30 min '
  'and jobs queued >60 min, then fails fix_attempts stuck running/queued >30 min '
  'with no live dispatch job, stamps the report processing_error (autofix_blocked) '
  'and logs to pipeline_runs when work was done.';

-- CREATE OR REPLACE keeps the existing ACL (postgres + service_role only);
-- restated so a fresh database matches production.
REVOKE ALL ON FUNCTION public.fix_attempts_stuck_reaper() FROM PUBLIC, anon, authenticated;
