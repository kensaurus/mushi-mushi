-- Migration: 20260611140000_notification_prefs
-- Per-project notification preferences (which events trigger Slack/Discord posts).
-- Default is all-on: a newly connected project receives all event types without
-- needing to opt in explicitly.
--
-- Schema:
-- {
--   "report.classified":    true,
--   "qa_story.failed":      true,
--   "qa_story.recovered":   true,
--   "fix.dispatched":       true,
--   "fix.pr_opened":        true,
--   "intelligence.report":  true,
--   "report_severity_min":  "medium"  -- minimum severity to notify (low/medium/high/critical)
-- }

ALTER TABLE project_settings
  ADD COLUMN IF NOT EXISTS notification_prefs jsonb NOT NULL DEFAULT '{
    "report.classified": true,
    "qa_story.failed": true,
    "qa_story.recovered": true,
    "fix.dispatched": true,
    "fix.pr_opened": true,
    "intelligence.report": true,
    "report_severity_min": "low"
  }'::jsonb;

COMMENT ON COLUMN project_settings.notification_prefs IS
  'Per-event Slack/Discord notification preferences. All keys default to true. report_severity_min filters report.classified notifications by severity.';
