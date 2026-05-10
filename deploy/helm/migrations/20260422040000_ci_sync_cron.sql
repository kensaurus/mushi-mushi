-- Phase 4 of the Mushi PDCA unblock. Adds a pg_cron job that ticks every 10
-- minutes and invokes the `ci-sync` edge function to backfill
-- fix_attempts.check_run_conclusion for PRs the webhook path never delivered.
--
-- Rationale: the `check_run`/`check_suite` webhook events rely on the GitHub
-- App being subscribed AND the webhook URL being reachable — either can
-- silently break and leave the PDCA "Check" stage stuck on null forever.
-- A cheap bounded-batch poll closes that gap without making every PR wait
-- on human intervention.
--
-- The job uses the shared mushi.edge_function_post() helper (created in
-- 20260422034500_cron_http_helper_via_runtime_config.sql) so the URL and
-- service-role key come from public.mushi_runtime_config instead of GUCs
-- that aren't set in cron sessions.

SELECT cron.unschedule('mushi-ci-sync-10m')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mushi-ci-sync-10m');

SELECT cron.schedule(
  'mushi-ci-sync-10m',
  '*/10 * * * *',
  $cron$
    SELECT mushi.edge_function_post(
      'ci-sync',
      '{}'::jsonb
    );
  $cron$
);
