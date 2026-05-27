-- Migration: fix_marketplace_cron_jobs
-- PURPOSE: Resolve duplicate / broken pg_cron jobs flagged in PR review.
--   - Unschedule `recompute-tester-reputation-daily` (used CALL on a FUNCTION).
--   - Unschedule duplicate `tester-leaderboard-refresh` (07000 already schedules
--     `refresh-tester-leaderboard-30d` on the same 15-minute cadence).
-- Keeps:
--   - refresh-tester-leaderboard-30d (MV refresh every 15 min)
--   - recompute-tester-reputation (edge function HTTP POST daily at 02:00 UTC)

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule(jobid)
      FROM cron.job
     WHERE jobname IN (
       'recompute-tester-reputation-daily',
       'tester-leaderboard-refresh'
     );
  END IF;
END;
$$;

COMMENT ON FUNCTION private.recompute_tester_reputation IS
  'SQL helper for on-demand single-tester recompute (SELECT private.recompute_tester_reputation(p_tester_id)). '
  'Daily batch recompute runs via the recompute-tester-reputation edge function cron job, not pg_cron CALL.';

-- Ensure the edge-function recompute cron exists (idempotent).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'recompute-tester-reputation') THEN
      PERFORM cron.schedule(
        'recompute-tester-reputation',
        '0 2 * * *',
        $cron$
          SELECT net.http_post(
            url    := (SELECT value FROM mushi_runtime_config WHERE key = 'edge_function_base_url')
                     || '/recompute-tester-reputation',
            headers := jsonb_build_object(
              'Content-Type', 'application/json',
              'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
            ),
            body   := '{}'::jsonb
          ) AS request_id;
        $cron$
      );
    END IF;
  END IF;
END;
$$;
