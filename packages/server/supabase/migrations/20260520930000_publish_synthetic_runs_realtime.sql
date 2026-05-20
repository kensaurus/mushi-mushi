-- Migration: 20260520930000_publish_synthetic_runs_realtime
--
-- InventoryPage.tsx subscribes to the supabase_realtime publication to show a
-- live chip when a synthetic run completes. The synthetic_runs table was never
-- added to the publication (20260417000000_telemetry_and_realtime.sql adds
-- llm_invocations, cron_runs, anti_gaming_events, reporter_devices — not
-- synthetic_runs).
--
-- Row-level filter in the subscription uses project_id so only the active
-- project's inserts fan out to each connected admin session.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'synthetic_runs'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE synthetic_runs;
  END IF;
END;
$$;
