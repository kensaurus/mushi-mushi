/*
FILE: 20260707100000_mcp_oauth.sql
PURPOSE: Real OAuth 2.1 authorization-code flow (with PKCE) for the hosted MCP
         endpoint, so MCP clients that speak the MCP auth spec (Claude Code
         `/mcp` login, Cursor, VS Code, etc.) can connect without the user
         hand-copying an API key into a config file.

OVERVIEW:
  Until now /oauth/* on the mcp function was a Smithery publisher-scan stub:
  it only accepted smithery.ai redirect URIs and minted a scan-only token.
  `claude mcp login mushi` therefore could not work. This migration adds the
  two tables backing the real flow:

    1. Client  → POST /oauth/register                 (RFC 7591 DCR)         → mcp_oauth_clients row
    2. Client  → GET  /oauth/authorize?...PKCE...     → mcp_oauth_requests row (pending)
                 → 302 to the console consent page (/mcp-auth?txn=<id>)
    3. User    → console approves, picks a project    → mints a real project
                 API key (label 'mcp-oauth'), stamps code_hash + access_token_raw
                 → browser redirected to redirect_uri?code=...&state=...
    4. Client  → POST /oauth/token (code + code_verifier)
                 → access_token = the minted `mushi_...` project API key

  The access token IS a normal project API key: it is validated by the same
  `project_api_keys` lookup as every other key, is visible and revocable in
  the console (Keys page), and carries only the scopes the approving
  owner/admin granted. No parallel token store to audit.

TABLES:
  mcp_oauth_clients   — dynamically registered OAuth clients (public clients,
                        token_endpoint_auth_method 'none', PKCE mandatory).
  mcp_oauth_requests  — one row per authorization attempt. Mirrors
                        cli_auth_requests: pending → approved | denied | expired,
                        one-time code exchange with a short redelivery grace
                        (access_token_raw nulled after the grace window).

SECURITY:
  - RLS RESTRICTIVE deny-all on both tables; only service-role edge functions
    read/write.
  - Authorization code: 32 random bytes; only its SHA-256 is stored after
    issuance (code_hash). Single-use via token_claimed_at + grace window.
  - PKCE S256 is REQUIRED (code_challenge NOT NULL); plain is rejected at the
    route layer.
  - Approval requires a signed-in console user with owner/admin on the chosen
    project — the minted key never exceeds the approver's privileges.
  - 10-minute TTL, pg_cron sweep marks stale pending rows expired.
*/

CREATE TABLE IF NOT EXISTS public.mcp_oauth_clients (
  client_id                   uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_name                 text,
  redirect_uris               text[]      NOT NULL,
  token_endpoint_auth_method  text        NOT NULL DEFAULT 'none',
  created_at                  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.mcp_oauth_requests (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id              uuid        NOT NULL REFERENCES public.mcp_oauth_clients(client_id) ON DELETE CASCADE,
  redirect_uri           text        NOT NULL,
  state                  text,
  scope                  text,
  resource               text,
  code_challenge         text        NOT NULL,
  code_challenge_method  text        NOT NULL DEFAULT 'S256'
                                     CHECK (code_challenge_method = 'S256'),
  status                 text        NOT NULL DEFAULT 'pending'
                                     CHECK (status IN ('pending', 'approved', 'denied', 'expired')),
  user_id                uuid        REFERENCES auth.users(id) ON DELETE CASCADE,
  project_id             uuid        REFERENCES public.projects(id) ON DELETE CASCADE,
  api_key_id             uuid,
  -- SHA-256 hex of the authorization code returned to the client on approval.
  code_hash              text,
  -- The minted project API key, stored temporarily so /oauth/token can return
  -- it once (plus a short redelivery grace for dropped responses), then nulled.
  access_token_raw       text,
  token_claimed_at       timestamptz,
  ip_hint                text,
  expires_at             timestamptz NOT NULL DEFAULT (now() + interval '10 minutes'),
  created_at             timestamptz NOT NULL DEFAULT now()
);

-- Token exchange looks up by code hash; sweep finds stale pending rows.
CREATE INDEX IF NOT EXISTS idx_mcp_oauth_requests_code_hash
  ON public.mcp_oauth_requests (code_hash) WHERE status = 'approved';
CREATE INDEX IF NOT EXISTS idx_mcp_oauth_requests_expires_at
  ON public.mcp_oauth_requests (expires_at) WHERE status = 'pending';

ALTER TABLE public.mcp_oauth_clients  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mcp_oauth_requests ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'mcp_oauth_clients'
      AND policyname = 'deny_all_mcp_oauth_clients'
  ) THEN
    EXECUTE 'CREATE POLICY deny_all_mcp_oauth_clients ON public.mcp_oauth_clients AS RESTRICTIVE FOR ALL TO public USING (false)';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'mcp_oauth_requests'
      AND policyname = 'deny_all_mcp_oauth_requests'
  ) THEN
    EXECUTE 'CREATE POLICY deny_all_mcp_oauth_requests ON public.mcp_oauth_requests AS RESTRICTIVE FOR ALL TO public USING (false)';
  END IF;
END $$;

-- Auto-expire pending rows past TTL — same pattern as cli-auth-expire.
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
    $cron$
  );
END $$;

COMMENT ON TABLE public.mcp_oauth_clients   IS 'RFC 7591 dynamically registered OAuth clients for the hosted MCP endpoint';
COMMENT ON TABLE public.mcp_oauth_requests  IS 'OAuth 2.1 authorization-code (PKCE) transactions for MCP client login';
COMMENT ON COLUMN public.mcp_oauth_requests.code_hash        IS 'SHA-256 hex of the single-use authorization code';
COMMENT ON COLUMN public.mcp_oauth_requests.access_token_raw IS 'Minted project API key, delivered once at token exchange then nulled';
