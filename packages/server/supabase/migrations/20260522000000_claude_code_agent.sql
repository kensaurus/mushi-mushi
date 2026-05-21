-- Migration: 20260522000000_claude_code_agent
-- Purpose: Add Claude Code Agent as a first-class autofix provider alongside
--          Cursor Cloud. The agent dispatches via GitHub repository_dispatch
--          to the anthropics/claude-code-action workflow in the user's repo —
--          same "fire-and-forget then catch via webhook" DX as cursor_cloud.
--
-- Changes:
--   1. Extend project_settings.autofix_agent CHECK to accept 'claude_code_agent'.
--   2. Add Claude credential + config columns to project_settings.
--   3. Add Claude run metadata columns to fix_attempts.
--   4. Seed the Claude Code Agent Marketplace plugin in plugin_registry.

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
      'cursor_cloud',
      'claude_code_agent'
    ));

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. Claude credentials + config in project_settings
--    Pattern mirrors cursor_cloud (vault-backed ref + optional config knobs).
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE project_settings
  ADD COLUMN IF NOT EXISTS claude_api_key_ref       TEXT,
  ADD COLUMN IF NOT EXISTS claude_default_model     TEXT    DEFAULT 'claude-opus-4-1',
  ADD COLUMN IF NOT EXISTS claude_workflow_event    TEXT    DEFAULT 'mushi_claude_fix',
  ADD COLUMN IF NOT EXISTS claude_default_branch    TEXT    DEFAULT 'main',
  ADD COLUMN IF NOT EXISTS claude_auto_create_pr    BOOLEAN DEFAULT true;

COMMENT ON COLUMN project_settings.claude_api_key_ref IS
  'Vault reference for the Anthropic API key used by the claude-code-action (format: vault://<path>). Never store the raw key here.';
COMMENT ON COLUMN project_settings.claude_default_model IS
  'Model slug passed to anthropics/claude-code-action. Defaults to claude-opus-4-1.';
COMMENT ON COLUMN project_settings.claude_workflow_event IS
  'GitHub repository_dispatch event type that triggers the mushi-claude-fix workflow. Default: mushi_claude_fix.';
COMMENT ON COLUMN project_settings.claude_default_branch IS
  'Base branch the GitHub Actions runner checks out before applying the fix. Default: main.';
COMMENT ON COLUMN project_settings.claude_auto_create_pr IS
  'When true, the workflow step runs `gh pr create --draft` after the agent finishes. Default: true.';

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. Claude run metadata in fix_attempts
--    Same shape as cursor_agent_id / cursor_run_id / cursor_artifacts.
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE fix_attempts
  ADD COLUMN IF NOT EXISTS claude_workflow_run_id   BIGINT,
  ADD COLUMN IF NOT EXISTS claude_workflow_run_url  TEXT,
  ADD COLUMN IF NOT EXISTS claude_dispatch_event_id TEXT,
  ADD COLUMN IF NOT EXISTS claude_artifacts         JSONB DEFAULT '[]'::jsonb;

COMMENT ON COLUMN fix_attempts.claude_workflow_run_id IS
  'GitHub Actions run ID for the mushi-claude-fix workflow run. Populated by the workflow_run webhook once the runner starts.';
COMMENT ON COLUMN fix_attempts.claude_workflow_run_url IS
  'GitHub Actions run HTML URL. Shown as "View workflow run" in the Fix card while the PR is pending.';
COMMENT ON COLUMN fix_attempts.claude_dispatch_event_id IS
  'UUID generated at dispatch time and echoed in the PR body (<!-- mushi-fix-id: <uuid> -->). Used by the webhook indexer to match the PR back to this fix_attempt.';
COMMENT ON COLUMN fix_attempts.claude_artifacts IS
  'JSON array of artifacts from the claude-code-action run: [{kind, path, mime}].';

-- ──────────────────────────────────────────────────────────────────────────────
-- 4. Seed the Claude Code Agent Marketplace plugin
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
  'claude-code-agent',
  'Claude Code Agent',
  'Dispatches a GitHub Actions workflow that runs anthropics/claude-code-action to fix bugs and open draft PRs automatically.',
  'mushi-mushi',
  '{
    "subscribes": ["report.classified", "fix.requested"],
    "dispatchMode": "github_dispatch",
    "config": {
      "api_key_ref":        { "type": "vault",   "label": "Anthropic API Key", "required": true,  "placeholder": "sk-ant-...", "helpId": "claude-api-key" },
      "default_model":      { "type": "text",    "label": "Model",             "required": false, "placeholder": "claude-opus-4-1" },
      "workflow_event":     { "type": "text",    "label": "Workflow event",    "required": false, "placeholder": "mushi_claude_fix" },
      "default_branch":     { "type": "text",    "label": "Base branch",       "required": false, "placeholder": "main" },
      "auto_create_pr":     { "type": "boolean", "label": "Auto-create PRs",  "required": false, "default": true }
    },
    "setupSteps": [
      "Add the mushi-claude-fix.yml workflow to your repo (see config help for the YAML)",
      "Set ANTHROPIC_API_KEY as a GitHub Actions secret in your repo",
      "Paste your Anthropic API key in the field below"
    ],
    "icon": "/icons/claude-code.svg",
    "docsUrl": "https://docs.claude.com/code",
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
