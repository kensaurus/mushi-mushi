ALTER TABLE public.cli_auth_requests
  ADD COLUMN IF NOT EXISTS cli_token_claimed_at timestamptz,
  ADD COLUMN IF NOT EXISTS client_id text;

CREATE INDEX IF NOT EXISTS idx_cli_auth_requests_client_pending
  ON public.cli_auth_requests (client_id)
  WHERE status = 'pending' AND client_id IS NOT NULL;

COMMENT ON COLUMN public.cli_auth_requests.cli_token_claimed_at IS
  'First successful token delivery. Raw token stays re-deliverable to the same device_code for a short grace window after this, then is nulled.';
COMMENT ON COLUMN public.cli_auth_requests.client_id IS
  'Random per-machine CLI identifier. A new /device/start supersedes the same client''s prior pending requests so stale approval tabs cannot be approved.';

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
NOTIFY pgrst, 'reload config';;
