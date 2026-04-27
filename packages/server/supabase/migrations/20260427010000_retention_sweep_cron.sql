-- =============================================================================
-- Retention sweep cron — fires daily at 03:00 UTC to enforce
-- pricing_plans.retention_days across every project.
--
-- Why this exists (M2 from the QA report):
--   `pricing_plans.retention_days` has shipped for months but nothing
--   actually deletes old rows. A Hobby plan promises a 7-day window;
--   a Pro plan promises 90; today we honor neither. The pre-existing
--   `mushi_apply_retention_policies()` (Wave SOC 2) only walks
--   `project_retention_policies` rows — projects without an explicit
--   override are never swept, which is the majority. The retention-sweep
--   edge function fixes that by reading the plan-derived window for
--   every project, not just the SOC 2 customers who configured an
--   override.
--
-- Implementation notes:
--   * The edge function uses `requireServiceRoleAuth`, so cron has to
--     send the Bearer token from `mushi_runtime_config.internal_caller_token`
--     via `mushi_internal_auth_header()` (Wave T pattern).
--   * `WHERE` guards skip the http_post when the runtime config has not
--     been seeded. Avoids the http_request_queue.url NOT NULL violation
--     that bricked six earlier crons (Wave T audit).
--   * Idempotent: re-running the migration unschedules any prior job
--     before re-creating the schedule, exactly like the Wave T crons.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron not installed; skipping retention-sweep schedule';
    RETURN;
  END IF;

  PERFORM cron.unschedule(jobname)
     FROM cron.job
    WHERE jobname = 'mushi-retention-sweep-daily';

  PERFORM cron.schedule(
    'mushi-retention-sweep-daily',
    '0 3 * * *',
    $cron$
      SELECT net.http_post(
        url     := public.mushi_runtime_supabase_url() || '/functions/v1/retention-sweep',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', public.mushi_internal_auth_header()
        ),
        body    := jsonb_build_object('trigger', 'cron')
      )
      WHERE public.mushi_runtime_supabase_url() IS NOT NULL
        AND public.mushi_internal_auth_header() IS NOT NULL;
    $cron$
  );
END $$;
