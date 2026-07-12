-- Schedule a daily reconciliation of sdk_versions against the npm registry.
-- The `sdk-versions-cron` edge function reads each @mushi-mushi/* package
-- from the npm registry and upserts the latest stable version, so the catalog
-- stays fresh even if the release-workflow sync step is skipped.
--
-- The cron is intentionally parked at 02:30 UTC (low-traffic window, after
-- the nightly retention sweep at 03:00 UTC finishes its batch reads).
--
-- Wrapped in a DO block that, consistent with every other mushi cron:
--   1. skips cleanly when pg_cron is absent (fresh / self-hosted DBs) instead
--      of failing the migration,
--   2. unschedules any prior job with this name so re-running the migration
--      updates the schedule idempotently,
--   3. resolves the URL + Authorization header from the public.mushi_runtime_*
--      helpers (with NULL guards) so a cluster missing runtime config simply
--      no-ops the job rather than erroring on every run.
--
-- The previous current_setting('app.supabase_edge_fn_url') / 'app.service_role_key'
-- GUC approach raised on the hosted Supabase project because those GUCs are not
-- configured for the cron role, silently breaking the job.

DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mushi-sdk-versions-reconcile-daily') THEN
      PERFORM cron.unschedule('mushi-sdk-versions-reconcile-daily');
    END IF;

    PERFORM cron.schedule(
      'mushi-sdk-versions-reconcile-daily',
      '30 2 * * *',  -- 02:30 UTC daily
      $job$
        SELECT net.http_post(
          url     := public.mushi_runtime_supabase_url() || '/functions/v1/sdk-versions-cron',
          headers := jsonb_build_object(
            'Content-Type',  'application/json',
            'Authorization', public.mushi_internal_auth_header()
          ),
          body    := '{}'::jsonb,
          timeout_milliseconds := 30000
        )
        WHERE public.mushi_runtime_supabase_url() IS NOT NULL
          AND public.mushi_internal_auth_header() IS NOT NULL;
      $job$
    );
  ELSE
    RAISE NOTICE 'pg_cron not installed; skipping sdk-versions-cron schedule.';
  END IF;
END $cron$;

NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
