-- Migration: recompute-tester-reputation daily cron + leaderboard refresh RPC
-- PURPOSE: Schedule the daily reputation recompute and add a helper RPC to
--          refresh the tester_leaderboard_30d materialized view.

-- ── RPC: refresh_tester_leaderboard ─────────────────────────────────────────
-- Called by recompute-tester-reputation at the end of each run.
-- The MV is also refreshed by the pg_cron job below (every 15 min),
-- but the edge function call ensures a fresh leaderboard after every
-- reputation recompute.

CREATE OR REPLACE FUNCTION public.refresh_tester_leaderboard()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, private
AS $$
BEGIN
  REFRESH MATERIALIZED VIEW CONCURRENTLY public.tester_leaderboard_30d;
END;
$$;

COMMENT ON FUNCTION public.refresh_tester_leaderboard IS
  'Refreshes the tester_leaderboard_30d MV. Called by the '
  'recompute-tester-reputation edge function and scheduled via pg_cron.';

-- ── pg_cron: reputation recompute (daily at 02:00 UTC) ───────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'recompute-tester-reputation',
      '0 2 * * *',
      $$
        SELECT net.http_post(
          url    := (SELECT value FROM mushi_runtime_config WHERE key = 'edge_function_base_url')
                   || '/recompute-tester-reputation',
          headers := jsonb_build_object(
            'Content-Type', 'application/json',
            'Authorization', 'Bearer ' || current_setting('app.service_role_key', true)
          ),
          body   := '{}'::jsonb
        ) AS request_id;
      $$
    );
  END IF;
END;
$$;

-- ── pg_cron: leaderboard refresh (every 15 min) ──────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'tester-leaderboard-refresh',
      '*/15 * * * *',
      $$
        SELECT public.refresh_tester_leaderboard();
      $$
    );
  END IF;
END;
$$;

-- ── anti_gaming_events: add tester_id and app_id columns ─────────────────────
-- So tester velocity events are traceable to a specific tester + app.
ALTER TABLE public.anti_gaming_events
  ADD COLUMN IF NOT EXISTS tester_id uuid REFERENCES public.mushi_testers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS app_id    uuid REFERENCES public.published_apps(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_anti_gaming_events_tester
  ON public.anti_gaming_events (tester_id, created_at DESC)
  WHERE tester_id IS NOT NULL;
