-- Phase 3: PDCA QA story auto-improve cron
-- Runs every 6 hours to find failed qa_story_runs and propose improvements.
-- The pdca-runner edge function handles mode='qa_story_improve'.
--
-- Implementation notes (matches the Wave T cron pattern — see
-- 20260427010000_retention_sweep_cron.sql):
--   * Idempotent: unschedule any prior job before (re)scheduling so re-runs
--     of this migration don't error on a duplicate jobname.
--   * Uses public.mushi_runtime_supabase_url() + public.mushi_internal_auth_header()
--     instead of reading vault.decrypted_secrets directly. pg_cron cannot
--     reliably read SUPABASE_SERVICE_ROLE_KEY, and these helpers keep the job
--     portable on hosted Supabase.
--   * WHERE guards skip the http_post when runtime config isn't seeded yet,
--     avoiding the http_request_queue.url NOT NULL violation that bricked
--     earlier crons.
--   * Guarded on pg_cron being installed.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron not installed; skipping pdca-qa-story-improve schedule';
    RETURN;
  END IF;

  PERFORM cron.unschedule(jobname)
     FROM cron.job
    WHERE jobname = 'pdca-qa-story-improve';

  PERFORM cron.schedule(
    'pdca-qa-story-improve',
    '0 */6 * * *',
    $cron$
      SELECT net.http_post(
        url     := public.mushi_runtime_supabase_url() || '/functions/v1/pdca-runner',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', public.mushi_internal_auth_header()
        ),
        body    := '{"mode":"qa_story_improve"}'::jsonb
      )
      WHERE public.mushi_runtime_supabase_url() IS NOT NULL
        AND public.mushi_internal_auth_header() IS NOT NULL;
    $cron$
  );
END $$;
