-- Migration: add agent_override to fix_dispatch_jobs
-- Allows per-dispatch agent selection without changing project_settings.autofix_agent.
-- The "Send to Cursor" button uses this to force cursor_cloud for a single report.

ALTER TABLE fix_dispatch_jobs
  ADD COLUMN IF NOT EXISTS agent_override TEXT DEFAULT NULL;

COMMENT ON COLUMN fix_dispatch_jobs.agent_override IS
  'Optional per-dispatch agent override. When set, fix-worker uses this instead of '
  'project_settings.autofix_agent. Allows one-off Cursor dispatches from the Reports UI.';
