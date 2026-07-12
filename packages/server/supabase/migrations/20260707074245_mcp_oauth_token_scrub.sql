-- =============================================================================
-- MCP OAuth hardening (code-review follow-up to 20260707100000_mcp_oauth):
--
--   1. The route comment and table comment both promise that the raw minted
--      API key (`access_token_raw`) is "nulled after the grace window" — but
--      the token endpoint only nulls it if a SECOND exchange arrives after
--      the 60s redelivery grace. On the happy path (one exchange, ever) the
--      plaintext, non-expiring key sat in the row forever. Mirror the CLI
--      device flow's cron scrub (20260702090000_cli_auth_two_phase_claim.sql)
--      inside the existing mcp-oauth-expire schedule.
--
--   2. `api_key_id` was a bare uuid; give it a real FK so a key deleted from
--      the console can't leave a dangling reference (SET NULL — the txn row
--      itself is audit history and should survive key revocation).
--
-- Idempotent: cron re-schedule + guarded ALTER TABLE.
-- =============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'mcp_oauth_requests_api_key_id_fkey'
      AND conrelid = 'public.mcp_oauth_requests'::regclass
  ) THEN
    ALTER TABLE public.mcp_oauth_requests
      ADD CONSTRAINT mcp_oauth_requests_api_key_id_fkey
      FOREIGN KEY (api_key_id) REFERENCES public.project_api_keys(id)
      ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'cron') THEN
    RAISE NOTICE 'pg_cron not installed; skipping mcp-oauth-expire schedule';
    RETURN;
  END IF;
  PERFORM cron.unschedule(jobid) FROM cron.job WHERE jobname = 'mcp-oauth-expire';
  PERFORM cron.schedule(
    'mcp-oauth-expire',
    '*/5 * * * *',
    $cron$
      UPDATE public.mcp_oauth_requests
      SET status = 'expired'
      WHERE status = 'pending' AND expires_at < now();

      -- Scrub the plaintext minted key once the single-use redelivery grace
      -- has passed (or the txn expired unclaimed). The key itself lives on in
      -- project_api_keys as a SHA-256 hash; only this delivery copy dies.
      UPDATE public.mcp_oauth_requests
      SET access_token_raw = NULL
      WHERE access_token_raw IS NOT NULL
        AND (
          (token_claimed_at IS NOT NULL AND token_claimed_at < now() - interval '60 seconds')
          OR expires_at < now()
        );
    $cron$
  );
END $$;
