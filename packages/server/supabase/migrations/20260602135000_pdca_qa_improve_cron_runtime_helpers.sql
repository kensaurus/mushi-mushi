-- Follow-up to 20260602000003_pdca_qa_improve_cron.sql.
--
-- That migration's body was edited in place after it had already been applied
-- to the remote (recorded as version 20260602023423), so the edit would never
-- reach the live database via `supabase db push`. This forward-dated migration
-- carries the same idempotent rewrite as an append-only entry and matches the
-- `pdca_qa_improve_cron_runtime_helpers` migration applied via MCP, keeping the
-- on-disk ledger and the remote in sync.
--
--   * Idempotent: unschedule any prior job before (re)scheduling.
--   * Uses public.mushi_runtime_supabase_url() + public.mushi_internal_auth_header()
--     instead of reading vault.decrypted_secrets directly — pg_cron cannot
--     reliably read SUPABASE_SERVICE_ROLE_KEY on hosted Supabase.
--   * WHERE guards skip the http_post when runtime config isn't seeded yet,
--     avoiding the http_request_queue.url NOT NULL violation.
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
