/*
FILE: 20260621130000_usage_alert_50_threshold.sql
PURPOSE: Add 50% diagnosis quota alert dedup column for usage-alerts cron.

OVERVIEW:
- project_settings.last_usage_alert_50_at — first early-warning threshold
- Complements existing 80% and 100% columns from 20260621120000

NOTES:
- Idempotent ADD COLUMN IF NOT EXISTS for db reset parity.
*/

ALTER TABLE project_settings
  ADD COLUMN IF NOT EXISTS last_usage_alert_50_at TIMESTAMPTZ;

COMMENT ON COLUMN project_settings.last_usage_alert_50_at IS
  'Last time the 50% diagnosis quota alert was sent. Used to dedup within a billing month.';
