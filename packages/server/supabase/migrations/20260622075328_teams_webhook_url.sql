-- Migration: Add Microsoft Teams webhook URL to project_settings
-- Adds teams_webhook_url column so Teams can receive the same
-- report-triaged and QA-failure notifications already sent to Slack/Discord.
-- Idempotent (ADD COLUMN IF NOT EXISTS).

ALTER TABLE project_settings
  ADD COLUMN IF NOT EXISTS teams_webhook_url text;

COMMENT ON COLUMN project_settings.teams_webhook_url IS
  'Optional Microsoft Teams incoming webhook URL (Power Automate or legacy Connector).
   Receives new-report and QA-failure notifications alongside Slack/Discord.
   Must start with https://; validated at write time by the settings PATCH route.';
