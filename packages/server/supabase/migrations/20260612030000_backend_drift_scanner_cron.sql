-- Migration: 20260612030000_backend_drift_scanner_cron
--
-- Schedules the backend-drift-scanner edge function as a daily pg_cron job.
-- The function snapshots each linked project's Supabase schema via the read-only
-- hosted MCP, diffs against the previous snapshot, and writes gate_findings of
-- type schema_drift when columns / tables / policies change unexpectedly.
--
-- Schedule: 03:05 UTC daily (after the retention-sweep at 02:17, before peak traffic).
-- Pattern: same net.http_post approach used by other cron-triggered edge functions
-- (retention-sweep, pdca-runner, qa-story-runner, etc.) per wave_s_hardening.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    -- Remove stale job if it exists.
    PERFORM cron.unschedule(jobname)
    FROM cron.job
    WHERE jobname = 'mushi-backend-drift-scanner-daily';

    PERFORM cron.schedule(
      'mushi-backend-drift-scanner-daily',
      '5 3 * * *',
      format(
        $cronq$
          SELECT net.http_post(
            url     := %L || '/functions/v1/backend-drift-scanner',
            headers := jsonb_build_object(
              'Content-Type',    'application/json',
              'Authorization',   'Bearer ' || public.mushi_runtime_service_role_key()
            ),
            body    := '{}'::jsonb
          );
        $cronq$,
        public.mushi_runtime_supabase_url()
      )
    );
  ELSE
    RAISE NOTICE 'pg_cron not installed; skipping backend-drift-scanner schedule.';
  END IF;
END;
$$;
