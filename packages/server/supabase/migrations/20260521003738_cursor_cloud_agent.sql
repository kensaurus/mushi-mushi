-- Migration: 20260521003738_cursor_cloud_agent
-- Purpose: Extend mushi-mushi to support Cursor Cloud Agents as a first-class
--          autofix agent and Marketplace plugin.
--
-- Changes:
--   1. Extend project_settings.autofix_agent CHECK to accept 'cursor_cloud'.
--   2. Add Cursor credential columns to project_settings.
--   3. Add Cursor run metadata columns to fix_attempts.
--   4. Seed the Cursor Cloud Agent Marketplace plugin in plugin_registry.

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. Extend autofix_agent CHECK constraint
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE project_settings
  DROP CONSTRAINT IF EXISTS project_settings_autofix_agent_check;

ALTER TABLE project_settings
  ADD CONSTRAINT project_settings_autofix_agent_check
    CHECK (autofix_agent IN (
      'claude_code',
      'codex',
      'mcp',
      'rest_fix_worker',
      'generic_mcp',
      'cursor_cloud'
    ));

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. Cursor credentials in project_settings
--    (vault-backed refs, mirrors github_installation_token_ref shape)
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE project_settings
  ADD COLUMN IF NOT EXISTS cursor_api_key_ref       TEXT,
  ADD COLUMN IF NOT EXISTS cursor_workspace_id      TEXT,
  ADD COLUMN IF NOT EXISTS cursor_default_model     TEXT    DEFAULT 'composer-2.5',
  ADD COLUMN IF NOT EXISTS cursor_auto_create_pr    BOOLEAN DEFAULT true,
  ADD COLUMN IF NOT EXISTS cursor_max_iterations    INT     DEFAULT 1;

COMMENT ON COLUMN project_settings.cursor_api_key_ref IS
  'Vault reference for the Cursor API key (format: vault://<uuid>). Never store the raw key here.';
COMMENT ON COLUMN project_settings.cursor_workspace_id IS
  'Cursor workspace ID (ws_…) — scopes agent runs to the customer''s workspace.';
COMMENT ON COLUMN project_settings.cursor_default_model IS
  'Default Cursor model slug for agent runs. Defaults to composer-2.5.';
COMMENT ON COLUMN project_settings.cursor_auto_create_pr IS
  'When true, Cursor automatically opens a signed draft PR after the agent run. Defaults to true.';
COMMENT ON COLUMN project_settings.cursor_max_iterations IS
  'Maximum agent iterations (loop count) per fix dispatch. Defaults to 1.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. Cursor run metadata in fix_attempts
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE fix_attempts
  ADD COLUMN IF NOT EXISTS cursor_agent_id  TEXT,
  ADD COLUMN IF NOT EXISTS cursor_run_id    TEXT,
  ADD COLUMN IF NOT EXISTS cursor_artifacts JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN fix_attempts.cursor_agent_id IS
  'Cursor agent ID (bc-…) for runs dispatched via cursor_cloud autofix_agent or Marketplace plugin.';
COMMENT ON COLUMN fix_attempts.cursor_run_id IS
  'Cursor run ID for the specific agent run.';
COMMENT ON COLUMN fix_attempts.cursor_artifacts IS
  'JSON array of artifacts produced by the Cursor agent: [{kind, path, mime}]. Screenshots, videos, logs.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 4. Seed the Cursor Cloud Agent Marketplace plugin
-- ──────────────────────────────────────────────────────────────────────────────

INSERT INTO plugin_registry (
  slug,
  name,
  short_description,
  publisher,
  manifest,
  required_scopes,
  category,
  is_official,
  is_listed
)
VALUES (
  'cursor-cloud-agent',
  'Cursor Cloud Agent',
  'Automatically opens a signed draft PR via a Cursor Cloud Agent whenever a critical report is classified.',
  'mushi-mushi',
  '{
    "subscribes": ["report.classified", "qa_story.failed", "fix.requested"],
    "dispatchMode": "rest",
    "restEndpoint": "https://api.cursor.com/v0/agents",
    "config": {
      "api_key_ref":     { "type": "vault",   "label": "API Key",       "required": true,  "placeholder": "cur_...",    "helpId": "cursor-api-key" },
      "workspace_id":    { "type": "text",    "label": "Workspace ID",  "required": true,  "placeholder": "ws_..." },
      "model":           { "type": "select",  "label": "Model",         "required": false, "options": ["composer-2.5", "composer-latest"], "default": "composer-2.5" },
      "auto_create_pr":  { "type": "boolean", "label": "Auto-create PRs","required": false, "default": true },
      "max_iterations":  { "type": "integer", "label": "Max iterations","required": false, "default": 1, "min": 1, "max": 10 }
    },
    "icon": "/icons/cursor-cloud.svg",
    "docsUrl": "https://cursor.com/docs/cloud-agent",
    "version": "1.0.0"
  }'::jsonb,
  ARRAY['reports.read'],
  'integration',
  true,
  true
)
ON CONFLICT (slug) DO UPDATE
  SET
    name              = EXCLUDED.name,
    short_description = EXCLUDED.short_description,
    manifest          = EXCLUDED.manifest,
    required_scopes   = EXCLUDED.required_scopes,
    is_official       = true,
    is_listed         = true;
