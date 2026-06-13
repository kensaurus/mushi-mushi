-- Migration: 20260611130000_slack_oauth_token_ref
-- Per-project Slack bot token (stored in Supabase Vault) and team metadata.
-- Supports the "Add to Slack" OAuth flow: the token replaces the platform-level
-- SLACK_BOT_TOKEN env var for multi-tenant bot delivery.

ALTER TABLE project_settings
  ADD COLUMN IF NOT EXISTS slack_bot_token_ref uuid REFERENCES vault.secrets(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS slack_team_name text;

COMMENT ON COLUMN project_settings.slack_bot_token_ref IS
  'Vault secret ID for the per-project Slack bot token (xoxb-*). When set, takes precedence over the global SLACK_BOT_TOKEN env var.';

COMMENT ON COLUMN project_settings.slack_team_name IS
  'Slack workspace name shown in the integrations panel after OAuth install.';
