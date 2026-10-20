-- =============================================================================
-- Migration: 20261020090056_byok_spend_down
-- =============================================================================
-- Spend-down mode (ADR 0028): while a Cursor key's credits are about to
-- expire, Mushi dispatches fixes on its own to the apps that already use that
-- key, inside each app's existing auto-fix caps.
--
-- Columns on byok_keys (the key that pays is the key that is configured):
--   credits_expire_at       when the account's credits stop being usable.
--                           Separate from expires_at (the credential itself).
--   spend_down_enabled      off by default; Cursor keys only (check below).
--   spend_down_model        Cursor model spec for these dispatches; NULL means
--                           the app's cursor_default_model.
--   spend_down_daily_limit  most dispatches this key starts per UTC day,
--                           across all its apps (1..200, default 10).
--   spend_down_window_days  how many days before credits_expire_at to start
--                           (1..90, default 14).
--   spend_down_last_run_at / spend_down_last_summary  what the last worker
--                           tick did, for the console and MCP status.
--
-- Cron `mushi-spend-down` calls the spend-down-worker edge function at :28 and
-- :58. Every other minute of a /5 or /10 lattice is already taken (status
-- reconciler 1-56/5, sdk-release-sync 2-57/5, agent-status-poll 5-55/5,
-- codebase drain 9-59/10, …); :28 and :58 are free. Same helpers and
-- idempotent unschedule-then-schedule as 20260912007000.
-- =============================================================================

ALTER TABLE public.byok_keys
  ADD COLUMN IF NOT EXISTS credits_expire_at timestamptz,
  ADD COLUMN IF NOT EXISTS spend_down_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS spend_down_model text,
  ADD COLUMN IF NOT EXISTS spend_down_daily_limit integer NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS spend_down_window_days integer NOT NULL DEFAULT 14,
  ADD COLUMN IF NOT EXISTS spend_down_last_run_at timestamptz,
  ADD COLUMN IF NOT EXISTS spend_down_last_summary jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'byok_keys_spend_down_check') THEN
    ALTER TABLE public.byok_keys
      ADD CONSTRAINT byok_keys_spend_down_check CHECK (
        spend_down_daily_limit BETWEEN 1 AND 200
        AND spend_down_window_days BETWEEN 1 AND 90
        AND (NOT spend_down_enabled OR (provider_slug = 'cursor' AND credits_expire_at IS NOT NULL))
        AND (spend_down_model IS NULL OR char_length(spend_down_model) BETWEEN 1 AND 300)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS byok_keys_spend_down_enabled_idx
  ON public.byok_keys (credits_expire_at)
  WHERE spend_down_enabled;

COMMENT ON COLUMN public.byok_keys.credits_expire_at IS
  'When this account''s usage credits expire (spend-down mode, ADR 0028). Not the credential expiry (expires_at).';
COMMENT ON COLUMN public.byok_keys.spend_down_enabled IS
  'Spend-down mode: dispatch fixes automatically to the apps this key serves, inside their auto-fix caps, from credits_expire_at - spend_down_window_days until credits_expire_at.';

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron not installed; skipping mushi-spend-down schedule';
    RETURN;
  END IF;

  PERFORM cron.unschedule(jobname)
     FROM cron.job
    WHERE jobname = 'mushi-spend-down';

  PERFORM cron.schedule(
    'mushi-spend-down',
    '28,58 * * * *',
    $cron$
      SELECT net.http_post(
        url     := public.mushi_runtime_supabase_url() || '/functions/v1/spend-down-worker',
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
