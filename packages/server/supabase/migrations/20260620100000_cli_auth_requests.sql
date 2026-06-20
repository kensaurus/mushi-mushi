/*
FILE: 20260620100000_cli_auth_requests.sql
PURPOSE: RFC 8628 Device Authorization Grant table for zero-copy-paste CLI login.

OVERVIEW:
  Implements the server side of the OAuth 2.0 Device Authorization Grant
  (RFC 8628) so `mushi login` can open a browser, let the already-signed-in
  console user approve the request, and receive a CLI session token with the
  user's project list — without the user ever copy-pasting credentials.

  Flow:
    1. CLI   → POST /v1/cli/auth/device/start   → { device_code, user_code, verification_uri }
    2. CLI   → opens browser to verification_uri (/cli-auth?code=XXXX)
    3. User  → console approves the user_code → POST /v1/cli/auth/device/approve (jwtAuth)
    4. CLI   → polls POST /v1/cli/auth/device/token until status='approved'
    5. CLI   → uses returned cli_token to list projects + mint a key

TABLE: cli_auth_requests
  - device_code        : UUID sent to the CLI (keep secret, not shown to user)
  - user_code          : 8-char uppercase code shown in both browser and terminal
  - status             : pending → approved | rejected | expired
  - user_id            : set on approval (FK → auth.users)
  - cli_token_hash     : SHA-256 of the CLI session token minted on approval
  - expires_at         : 10-minute TTL
  - created_at         : audit trail

SECURITY:
  - RLS is RESTRICTIVE deny-all; only the edge function (service role) reads/writes.
  - device_code is 128-bit entropy (UUID4) — not guessable.
  - cli_token_hash stores only the hash; raw token returned once at approval time.
  - Expired rows are cleaned up by a pg_cron job (see below).
*/

CREATE TABLE IF NOT EXISTS public.cli_auth_requests (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  device_code   uuid        NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  user_code     text        NOT NULL,
  status        text        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),
  user_id       uuid        REFERENCES auth.users(id) ON DELETE CASCADE,
  cli_token_hash text,
  -- Raw CLI token stored temporarily so the poll endpoint can return it once,
  -- then nulled out (one-time retrieval). Never persisted long-term.
  cli_token_raw  text,
  ip_hint       text,
  expires_at    timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Also handle idempotent re-runs after the table already exists.
ALTER TABLE public.cli_auth_requests ADD COLUMN IF NOT EXISTS cli_token_raw text;

-- Fast lookups by user_code (console approval) and device_code (CLI poll)
CREATE INDEX IF NOT EXISTS idx_cli_auth_requests_user_code    ON public.cli_auth_requests (user_code)    WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_cli_auth_requests_device_code  ON public.cli_auth_requests (device_code)  WHERE status IN ('pending', 'approved');
-- TTL sweep: cron finds expired pending rows
CREATE INDEX IF NOT EXISTS idx_cli_auth_requests_expires_at   ON public.cli_auth_requests (expires_at)   WHERE status = 'pending';

-- RLS: only the service-role edge function may read or write this table.
ALTER TABLE public.cli_auth_requests ENABLE ROW LEVEL SECURITY;

-- Explicit deny-all for authenticated / anon callers (security advisor compliant).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename  = 'cli_auth_requests'
      AND policyname = 'deny_all_cli_auth_requests'
  ) THEN
    EXECUTE 'CREATE POLICY deny_all_cli_auth_requests ON public.cli_auth_requests AS RESTRICTIVE FOR ALL TO public USING (false)';
  END IF;
END $$;

-- Auto-expire: mark pending rows as expired once their TTL has elapsed.
-- Runs every 5 minutes; harmless no-op when table is empty. Guarded on
-- pg_cron presence and unscheduled-first so the migration is idempotent on
-- `db reset` (cron.schedule otherwise duplicates / errors on re-run).
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
    $cron$
  );
END $$;

COMMENT ON TABLE  public.cli_auth_requests IS 'RFC 8628 device-auth requests for zero-copy-paste CLI login';
COMMENT ON COLUMN public.cli_auth_requests.device_code     IS 'Secret UUID polled by the CLI — never shown to the user';
COMMENT ON COLUMN public.cli_auth_requests.user_code       IS '8-char code shown in both terminal and browser for user to confirm';
COMMENT ON COLUMN public.cli_auth_requests.cli_token_hash  IS 'SHA-256 of the minted CLI session token; raw token returned once at approval';
COMMENT ON COLUMN public.cli_auth_requests.ip_hint         IS 'Originating IP for display in the approval screen (trust signal only)';

-- Flush the PostgREST schema/config cache so the new table, indexes, and RLS
-- policy are visible to the API immediately after deploy (standard for any
-- migration that adds PostgREST-exposed objects).
NOTIFY pgrst, 'reload schema';
NOTIFY pgrst, 'reload config';
