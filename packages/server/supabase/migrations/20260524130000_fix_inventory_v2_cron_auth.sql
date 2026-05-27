-- =============================================================================
-- Fix inventory v2 cron auth (status-reconciler + synthetic-monitor)
--
-- Root cause (Postgres ERROR every 5 min):
--   `mushi-status-reconciler-tick` and `mushi-synthetic-monitor-tick` were
--   registered in 20260504000000_v2_bidirectional_graph.sql with
--   `current_setting('app.settings.supabase_url', true)` and
--   `current_setting('app.settings.service_role_key', true)`.
--   On hosted Supabase those GUCs are never set, so net.http_post receives
--   url := NULL and Postgres rejects the insert into http_request_queue:
--     "null value in column \"url\" violates not-null constraint"
--
-- Fix: migrate both jobs to the canonical `mushi.edge_function_post()` helper
-- (Wave T, 20260423040000) which reads supabase_url + service_role_key from
-- mushi_runtime_config — the same path every other cron uses.
--
-- Idempotent: unschedule by jobname before re-scheduling.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron not installed; skipping inventory v2 cron auth fix';
    RETURN;
  END IF;

  PERFORM cron.unschedule(jobname)
    FROM cron.job
   WHERE jobname IN ('mushi-status-reconciler-tick', 'mushi-synthetic-monitor-tick');

  PERFORM cron.schedule(
    'mushi-status-reconciler-tick',
    '*/5 * * * *',
    $cron$
      SELECT mushi.edge_function_post(
        'status-reconciler',
        '{"trigger":"cron"}'::jsonb
      );
    $cron$
  );

  PERFORM cron.schedule(
    'mushi-synthetic-monitor-tick',
    '*/15 * * * *',
    $cron$
      SELECT mushi.edge_function_post(
        'synthetic-monitor',
        '{"trigger":"cron"}'::jsonb
      );
    $cron$
  );
END $$;
