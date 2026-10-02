-- ============================================================================
-- 20261002130110_recipe_collector_cron
--
-- Plan 019 §5.1 item 9 (Phase 1b): run the recipe-collector edge function
-- daily at 03:35 UTC, clear of backend-drift-scanner at 03:05. It refreshes
-- each project's app_recipe_snapshots row and, at most once per ~day, runs
-- the design_drift deviance scan. Bounded to 25 projects per run inside the
-- function; 60 s for the HTTP call is the pg_net timeout, not the run time.
--
-- After apply, run it once by hand and read the log (repo memory: a changed
-- hot helper is verified by one real run, not by the 200):
--   select mushi.cron_http_post('recipe-collector', '{}'::jsonb, 60000);
--   select status, return_message, start_time from cron.job_run_details
--    where jobid = (select jobid from cron.job where jobname = 'mushi-recipe-collector-daily')
--    order by start_time desc limit 3;
-- ============================================================================

select cron.schedule('mushi-recipe-collector-daily', '35 3 * * *',
  $$select mushi.cron_http_post('recipe-collector', jsonb_build_object('trigger', 'cron'), 60000);$$);
