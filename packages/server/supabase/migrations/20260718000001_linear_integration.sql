-- Migration: Add vault-backed Linear integration columns to project_settings and
-- organization_integration_settings. These replace the plaintext config stored
-- in project_integrations.config for the 'linear' integration_type.
--
-- Resolution order (mirrors other platform integrations):
--   1. project_settings (project-scoped, wins)
--   2. organization_integration_settings (org default, inherited when project field is null)
--   3. Env var LINEAR_API_KEY (self-hosted fallback)
--
-- Columns:
--   linear_api_key_ref          — static Personal API key (vault://<uuid> or raw fallback)
--   linear_access_token_ref     — OAuth 2.0 access token (vault://<uuid>)
--   linear_refresh_token_ref    — OAuth 2.0 refresh token (vault://<uuid>)
--   linear_workspace_name       — display-only workspace/org name from OAuth (not secret)
--   linear_team_id              — default team UUID for issue creation
--   linear_webhook_secret_ref   — HMAC secret returned by Linear's webhookCreate (vault://<uuid>)
--   linear_actor_token_ref      — app actor token for agent mode actor=app (vault://<uuid>)
--
-- Webhook secret and actor token are intentionally project-scoped only (not org-level)
-- because they are registered per Linear workspace OAuth install.

-- ── project_settings ──────────────────────────────────────────────────────

ALTER TABLE project_settings
  ADD COLUMN IF NOT EXISTS linear_api_key_ref         text,
  ADD COLUMN IF NOT EXISTS linear_access_token_ref    text,
  ADD COLUMN IF NOT EXISTS linear_refresh_token_ref   text,
  ADD COLUMN IF NOT EXISTS linear_workspace_name      text,
  ADD COLUMN IF NOT EXISTS linear_team_id             text,
  ADD COLUMN IF NOT EXISTS linear_webhook_secret_ref  text,
  ADD COLUMN IF NOT EXISTS linear_actor_token_ref     text;

-- ── organization_integration_settings ─────────────────────────────────────
-- Org-level defaults: api key, OAuth token, workspace name, and team.
-- Webhook secret / actor token are install-specific so not org-inherited.

ALTER TABLE organization_integration_settings
  ADD COLUMN IF NOT EXISTS linear_api_key_ref         text,
  ADD COLUMN IF NOT EXISTS linear_access_token_ref    text,
  ADD COLUMN IF NOT EXISTS linear_refresh_token_ref   text,
  ADD COLUMN IF NOT EXISTS linear_workspace_name      text,
  ADD COLUMN IF NOT EXISTS linear_team_id             text;

-- ── linear_oauth_states ───────────────────────────────────────────────────
-- Short-lived state tokens for the OAuth CSRF / nonce check.
-- The authorize endpoint inserts a row; the callback validates and deletes it.
-- TTL enforced by a pg_cron sweep (or max_age check in the callback).

CREATE TABLE IF NOT EXISTS linear_oauth_states (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL,
  nonce       text NOT NULL UNIQUE,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Auto-expire rows older than 10 minutes (stale CSRF tokens).
CREATE INDEX IF NOT EXISTS linear_oauth_states_created_at_idx
  ON linear_oauth_states (created_at);

-- RLS: rows are internal-only; accessed only via service-role client.
ALTER TABLE linear_oauth_states ENABLE ROW LEVEL SECURITY;
-- No policies needed — service-role bypasses RLS.
