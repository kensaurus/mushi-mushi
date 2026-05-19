-- Fix qa-story-runner-tick: the previous schedule relied on
-- current_setting('app.settings.supabase_url'/'app.settings.service_role_key')
-- which return NULL on this project, so pg_cron has been failing every minute
-- with: null value in column "url" of relation "http_request_queue".
--
-- Symptom: cron.job_run_details rows for jobid 46 ('qa-story-runner-tick') all
-- failed inside Postgres BEFORE reaching the edge function, so:
--   - no qa-story-runner invocation ever ran from cron
--   - public.cron_runs stayed empty for job_name = 'qa-story-runner'
--   - any QA story with schedule_cron matching the minute went un-executed
--
-- Fix: use the standard public/mushi helper that every other healthy cron job
-- uses (sentry-seer-poll, ci-sync, plugin-dispatch-retry, etc.). That helper
-- resolves the project URL + service-role auth from the same place as the
-- rest of the platform and gates on both being present.
--
-- Safe to re-run: cron.unschedule no-ops if the job is missing; cron.schedule
-- replaces an existing job with the same name (it's keyed by jobname here).

DO $$
BEGIN
  PERFORM cron.unschedule('qa-story-runner-tick');
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END;
$$;

SELECT cron.schedule(
  'qa-story-runner-tick',
  '* * * * *',
  $$ SELECT mushi.edge_function_post('qa-story-runner', '{"trigger":"cron"}'::jsonb); $$
);
