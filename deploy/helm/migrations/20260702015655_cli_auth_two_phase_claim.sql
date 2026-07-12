/*
FILE: 20260702090000_cli_auth_two_phase_claim.sql
PURPOSE: Fix two production failure modes in the RFC 8628 CLI device-auth flow
         ("browser says CLI connected!, terminal never continues").

CHANGES:
  1. cli_token_claimed_at — two-phase token claim. The token endpoint used to
     null cli_token_raw BEFORE the CLI durably received the response; a dropped
     HTTP response turned into a terminal invalid_grant on the next poll. Now
     the first successful read stamps claimed_at and the raw token stays
     re-deliverable to the same device_code for a short grace window (enforced
     in the edge function), after which it is nulled. device_code is a secret
     128-bit UUID known only to the CLI, so re-delivery within the window does
     not widen the attack surface.
  2. client_id — a random per-machine identifier persisted by the CLI. Each
     /device/start supersedes the caller's own prior pending requests so a
     stale approval tab (from a Ctrl+C'd or re-run wizard) can no longer be
     approved while the terminal polls a different device_code forever.
  3. Cron sweep hardening — the 5-minute sweep now also scrubs cli_token_raw
     from rows whose grace window elapsed or whose TTL expired, so raw tokens
     never linger in the table beyond their useful life.
*/

ALTER TABLE public.cli_auth_requests
  ADD COLUMN IF NOT EXISTS cli_token_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS client_id text;

-- Supersede lookup: find the caller's own still-pending rows on /device/start.
CREATE INDEX IF NOT EXISTS idx_cli_auth_requests_client_pending
  ON public.cli_auth_requests (client_id)
  WHERE status = 'pending' AND client_id IS NOT NULL;

COMMENT ON COLUMN public.cli_auth_requests.cli_token_claimed_at IS
  'First successful token delivery. Raw token stays re-deliverable to the same device_code for a short grace window after this, then is nulled.';
COMMENT ON COLUMN public.cli_auth_requests.client_id IS
  'Random per-machine CLI identifier. A new /device/start supersedes the same client''s prior pending requests so stale approval tabs cannot be approved.';

-- Replace the sweep so it also scrubs raw tokens past their useful life:
--   a) claimed and past the 60s re-delivery grace window
--   b) never claimed but the request TTL has expired
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron not installed; skipping cli-auth-expire schedule';
    RETURN;
  END IF;

  PERFORM cron.unschedule(jobid)
    FROM cron.job
   WHERE jobname = 'cli-auth-expire';

  PERFORM cron.schedule(
    'cli-auth-expire',
    '*/5 * * * *',
    $cron$
      UPDATE public.cli_auth_requests
         SET status = 'expired'
       WHERE status = 'pending'
         AND expires_at < now();
      UPDATE public.cli_auth_requests
         SET cli_token_raw = NULL
       WHERE cli_token_raw IS NOT NULL
         AND (
           (cli_token_claimed_at IS NOT NULL AND cli_token_claimed_at < now() - interval '60 seconds')
           OR expires_at < now()
         );
    $cron$
  );
END $$;

NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
