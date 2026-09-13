-- =============================================================================
-- Migration: 20260912007000_agent_status_poll_cron
-- =============================================================================
-- Registers pg_cron job `mushi-agent-status-poll`, which invokes the
-- `agent-status-poll` edge function so cloud coding agents (cursor_cloud /
-- github_cloud_agent) are polled to completion: Cursor v1 has no webhook yet
-- and GitHub Agent Tasks never will.
--
-- Schedule: '5-55/5 * * * *' — every five minutes on :05, :10, …, :55.
--   * Every offset-minute under a /5 cadence is already taken by a staggered
--     edge job (20260819150000_stagger_edge_cron_thundering_herd.sql:
--     status-reconciler 1-56/5, ci-sync 2-52/10, synthetic-monitor 3-48/15,
--     integration-health-probe 4-49/15, sentry-seer-poll 8-53/15, plus the
--     hourly :07 :09 :13 :17 :24 and the 6-hourly :37), so the only
--     collision-free /5 lattice is the one on multiples of five — MINUS the
--     :00 boundary, which that migration reserves for no recurring edge
--     invocation at all. '5-55/5' is exactly that lattice without :00
--     (max gap 10 min between :55 and :05, which the 2-minute poll floor and
--     the 24-hour give-up window tolerate).
--   * Once-a-day overlaps remain with the SQL-only 02:30 / 03:30 / 04:30
--     jobs (sdk-versions reconcile, matview refreshes, quest expiry,
--     reputation recompute) — they do not touch the edge runtime.
--   * Every-minute jobs (qa-story-runner-tick, plugin-dispatch-retry,
--     fix-dispatch-sweeper) are designed steady-state load and unchanged.
--
-- Uses ONLY the on-disk helpers `public.mushi_runtime_supabase_url()` and
-- `public.mushi_internal_auth_header()` (20260423040000) with net.http_post —
-- never the hosted-only `mushi.edge_function_post`. Unschedule-then-schedule
-- keeps the migration idempotent; the DO block skips cleanly when pg_cron is
-- absent (local `supabase start`, CI).
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron not installed; skipping mushi-agent-status-poll schedule';
    RETURN;
  END IF;

  PERFORM cron.unschedule(jobname)
     FROM cron.job
    WHERE jobname = 'mushi-agent-status-poll';

  PERFORM cron.schedule(
    'mushi-agent-status-poll',
    '5-55/5 * * * *',
    $cron$
      SELECT net.http_post(
        url     := public.mushi_runtime_supabase_url() || '/functions/v1/agent-status-poll',
        headers := jsonb_build_object(
          'Content-Type',  'application/json',
          'Authorization', public.mushi_internal_auth_header()
        ),
        body    := '{}'::jsonb
      )
      WHERE public.mushi_runtime_supabase_url() IS NOT NULL
        AND public.mushi_internal_auth_header() IS NOT NULL;
    $cron$
  );
END $$;
