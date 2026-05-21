-- Migration: 20260520920000_anomaly_detector_cron
--
-- The anomaly-detector edge function (packages/server/supabase/functions/anomaly-detector/)
-- documents "Cron: pg_cron runs this hourly per project" but no pg_cron schedule
-- was ever registered. This mirrors the fix applied in 20260520400000 for
-- qa-story-runner: schedule a single tick that fans out to every active project.
--
-- The cron fires at :07 past each hour to stagger it away from the :00 burst
-- (qa-story-runner, intelligence-report, etc.).

DO $$
BEGIN
  -- Only register if pg_cron is available (local dev may skip)
  IF EXISTS (
    SELECT 1 FROM pg_extension WHERE extname = 'pg_cron'
  ) THEN
    -- Drop stale entry if it exists under a different name before creating
    PERFORM cron.unschedule('mushi-anomaly-detector')
      WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mushi-anomaly-detector');

    PERFORM cron.schedule(
      'mushi-anomaly-detector',
      '7 * * * *',
      $$ SELECT mushi.edge_function_post('anomaly-detector', '{"trigger":"cron"}'::jsonb); $$
    );
  END IF;
END;
$$;

COMMENT ON EXTENSION pg_cron IS
  'Scheduled jobs — see cron.job for mushi-* entries';
