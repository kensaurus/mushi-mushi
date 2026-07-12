-- Migration: 20260621120000_usage_alerts_schema.sql
-- PURPOSE: Add dedup columns to project_settings for the usage-alerts edge
--   function, and schedule the hourly cron job.
--
-- Adds:
--   project_settings.last_usage_alert_80_at   — when the 80% alert last fired
--   project_settings.last_usage_alert_100_at  — when the 100% alert last fired
--   project_settings.alert_email              — override address for usage alerts
--                                               (defaults to project owner email)
--
-- Cron:
--   usage-alerts runs at the top of every hour so the maximum detection lag
--   is 60 minutes (hourly cron). This is deliberately conservative — alert
--   emails are high-signal and should not spam.

-- ── 1. Alert dedup + override columns ────────────────────────────────────

ALTER TABLE project_settings
  ADD COLUMN IF NOT EXISTS last_usage_alert_80_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS last_usage_alert_100_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS alert_email             TEXT;

COMMENT ON COLUMN project_settings.last_usage_alert_80_at IS
  'Last time the 80% diagnosis quota alert was sent for this project. Used to dedup within a billing month.';

COMMENT ON COLUMN project_settings.last_usage_alert_100_at IS
  'Last time the 100% (over-quota) diagnosis alert was sent. Used to dedup within a billing month.';

COMMENT ON COLUMN project_settings.alert_email IS
  'Optional override email for usage alerts. Falls back to the project owner email when NULL.';

-- ── 2. Helper RPC: batch-fetch user emails from auth.users ───────────────
-- usage-alerts needs project owner emails. The Supabase auth.admin JS API
-- only exposes getUserById (one call per user). This SECURITY DEFINER RPC
-- allows the edge function to get all emails in a single query.

CREATE OR REPLACE FUNCTION public.get_user_emails_by_ids(p_user_ids uuid[])
RETURNS TABLE(id uuid, email text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id, email FROM auth.users WHERE id = ANY(p_user_ids);
$$;

REVOKE EXECUTE ON FUNCTION public.get_user_emails_by_ids(uuid[]) FROM PUBLIC, anon, authenticated;
-- Only service role (edge functions) may call this.

-- ── 3. pg_cron job — hourly at :00 ───────────────────────────────────────
-- Invokes the usage-alerts edge function once an hour (max 60-min detection
-- lag). The URL + auth header are resolved at runtime via the canonical
-- public.mushi_runtime_supabase_url() / public.mushi_internal_auth_header()
-- helpers — the SAME pattern every other internal cron in this repo uses
-- (e.g. mushi-usage-aggregator-hourly). The WHERE guard makes the cron a no-op
-- on environments where runtime config is unset (local dev) instead of erroring.
--
-- Guarded by pg_cron presence; cron.schedule() upserts by name so re-running
-- this migration simply refreshes the job (idempotent / db-reset safe).
DO $sched$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'usage-alerts-hourly',
      '0 * * * *',
      $cron$
        SELECT net.http_post(
          url     := public.mushi_runtime_supabase_url() || '/functions/v1/usage-alerts',
          headers := jsonb_build_object(
            'Content-Type',  'application/json',
            'Authorization', public.mushi_internal_auth_header()
          ),
          body    := jsonb_build_object('trigger', 'cron'),
          timeout_milliseconds := 60000
        )
        WHERE public.mushi_runtime_supabase_url() IS NOT NULL;
      $cron$
    );
  END IF;
END;
$sched$;
