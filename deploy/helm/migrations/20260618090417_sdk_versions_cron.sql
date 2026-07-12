DO $cron$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'mushi-sdk-versions-reconcile-daily') THEN
      PERFORM cron.unschedule('mushi-sdk-versions-reconcile-daily');
    END IF;

    PERFORM cron.schedule(
      'mushi-sdk-versions-reconcile-daily',
      '30 2 * * *',
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
NOTIFY pgrst, 'reload config';;
