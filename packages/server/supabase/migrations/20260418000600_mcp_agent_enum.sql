-- Migration: 20260418000600_mcp_agent_enum
-- Purpose:   Allow `mcp` and `rest_fix_worker` as valid autofix_agent values
--            (V5.3 §2.10, M7). The previous `generic_mcp` value was a misnomer
--            (it spoke REST, not MCP). It is preserved for backwards compat
--            but new projects should pick `mcp` (true Model Context Protocol)
--            or `rest_fix_worker` (HTTP+JSON).
--
-- Optional bearer token forwarded on every fix call (HTTP Authorization header)
-- so customers can auth their self-hosted worker without putting secrets in URLs.

ALTER TABLE project_settings
  ADD COLUMN IF NOT EXISTS autofix_mcp_bearer TEXT;

DO $$
BEGIN
  -- Drop any pre-existing CHECK constraint so we can replace it.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'project_settings'::regclass
       AND conname = 'project_settings_autofix_agent_check'
  ) THEN
    ALTER TABLE project_settings DROP CONSTRAINT project_settings_autofix_agent_check;
  END IF;
END $$;

ALTER TABLE project_settings
  ADD CONSTRAINT project_settings_autofix_agent_check
  CHECK (autofix_agent IN ('claude_code', 'codex', 'mcp', 'rest_fix_worker', 'generic_mcp'));

COMMENT ON COLUMN project_settings.autofix_agent IS
  'Agent identifier. ''mcp'' = JSON-RPC 2.0 MCP client (preferred). ''rest_fix_worker'' = HTTP+JSON worker. ''generic_mcp'' = deprecated alias for rest_fix_worker.';

COMMENT ON COLUMN project_settings.autofix_mcp_bearer IS
  'Optional Bearer token sent on every MCP/REST fix-worker request.';
