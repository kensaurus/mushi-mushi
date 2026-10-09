/*
FILE: 20261007141000_codebase_analyze_drain_cron.sql
PURPOSE: Drain codebase_analyze_jobs every 10 minutes.

OVERVIEW:
- On 2026-10-07 all 53 rows of codebase_analyze_jobs (7 projects) were still
  'queued' and project_codebase_graph was empty. The only thing that started
  the worker was a fire-and-forget kick from the push indexer and the
  Re-analyze route, and every kick got a 404: the worker routed Hono '/'
  while Supabase hands it '/codebase-analyze-worker' (function edge logs,
  2026-10-06 and 2026-10-07). The route is fixed in the same change; this
  job makes sure a job nobody kicks, or a kick that is lost, still runs.
- POST with no jobId: the worker requeues jobs still 'running' after
  15 minutes, then runs the oldest queued jobs (5 per call, each claimed with
  a conditional update). It answers 202 at once and keeps working under
  EdgeRuntime.waitUntil, so the 60 s pg_net timeout is never the run time.

NOTES:
- Additive and idempotent: cron.schedule with an existing name replaces that
  job. Skips cleanly when pg_cron is absent (local supabase start, CI).
- Same helper and shape as the other function crons
  (20260922000010_cron_repairs_and_http_watchdog.sql); no helper changes.
- '9-59/10' (:09 :19 … :59): the /5 lattices on 0, 1 and 2 mod 5 are taken
  every hour. It shares :09 with usage-aggregator and :19 / :49 with
  integration-health-probe.
- Deploy codebase-analyze-worker (route fix) before or with this migration;
  the old build 404s these calls too, which the watchdog reports as
  'http:codebase-analyze-worker' errors in public.cron_runs.

VERIFY after apply (one real run, not just the 202):
  select mushi.cron_http_post('codebase-analyze-worker',
    jsonb_build_object('trigger', 'manual', 'limit', 5), 60000);
  -- a few minutes later:
  select status, count(*) from public.codebase_analyze_jobs group by 1;
  select status, return_message, start_time from cron.job_run_details
   where jobid = (select jobid from cron.job where jobname = 'mushi-codebase-analyze-drain-10m')
   order by start_time desc limit 3;
*/

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron not installed; skipping mushi-codebase-analyze-drain-10m schedule';
    RETURN;
  END IF;

  PERFORM cron.schedule(
    'mushi-codebase-analyze-drain-10m',
    '9-59/10 * * * *',
    $cmd$select mushi.cron_http_post('codebase-analyze-worker', jsonb_build_object('trigger', 'cron', 'limit', 5), 60000);$cmd$
  );
END $$;
