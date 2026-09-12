-- =============================================================================
-- Migration: 20260912006000_agent_backends
-- =============================================================================
-- Cloud coding-agent backends (exec plan dead-code-voice-agent-loop, C4):
--
--   1. project_settings.autofix_agent CHECK gains 'github_cloud_agent'
--      (GitHub Copilot Agent Tasks). 'cursor_cloud' was already allowed by
--      20260521003738 but nothing could run it until fix-worker step 2b.
--      'anthropic_managed' is interface-only in _shared/agent-adapters.ts and
--      is deliberately NOT selectable yet.
--   2. fix_attempts learns the vendor pointers the poller / webhook / GitHub
--      indexer need to close the loop:
--        external_agent_ref  jsonb   vendor ids, status URL, webhook ids seen,
--                                    last poll status — one column for every
--                                    backend (cursor_* columns stay for the
--                                    console; github_task_* mirror them)
--        github_task_id      text    Agent Tasks task id
--        github_task_url     text    task html_url
--        branch_name         text    branch the agent was ASKED to push to
--                                    (Cursor) or the head_ref learned from
--                                    the vendor (Copilot: copilot/…). The
--                                    GitHub indexer matches pull_request
--                                    webhooks on it when pr_url is still NULL.
--   3. Indexes for the poller (open cloud attempts without a PR), the
--      head-ref fallback, and the v0 webhook lookup by cursor_agent_id.
--
-- Idempotent: every statement is IF NOT EXISTS / DROP-then-ADD.
-- =============================================================================

-- 1. autofix_agent CHECK ------------------------------------------------------
ALTER TABLE public.project_settings
  DROP CONSTRAINT IF EXISTS project_settings_autofix_agent_check;

ALTER TABLE public.project_settings
  ADD CONSTRAINT project_settings_autofix_agent_check
    CHECK (autofix_agent IN (
      'claude_code',
      'codex',
      'mcp',
      'rest_fix_worker',
      'generic_mcp',
      'cursor_cloud',
      'claude_code_agent',
      'github_cloud_agent'
    ));

COMMENT ON COLUMN public.project_settings.autofix_agent IS
  'Default fix backend. claude_code / rest_fix_worker / llm run the in-edge LLM path; '
  'cursor_cloud and github_cloud_agent hand the report to a vendor-hosted repo agent '
  '(fix-worker step 2b via _shared/agent-adapters.ts) and are finished by cursor-webhook / '
  'agent-status-poll / webhooks-github-indexer; codex, mcp, generic_mcp, claude_code_agent '
  'are orchestrator-only and skip with skipped_unsupported_agent.';

-- 2. fix_attempts vendor pointers -------------------------------------------
ALTER TABLE public.fix_attempts
  ADD COLUMN IF NOT EXISTS external_agent_ref jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS github_task_id     text,
  ADD COLUMN IF NOT EXISTS github_task_url    text,
  ADD COLUMN IF NOT EXISTS branch_name        text;

COMMENT ON COLUMN public.fix_attempts.external_agent_ref IS
  'Cloud-agent bookkeeping (jsonb): { kind, external_agent_id, external_run_id, status_url, '
  'branch_name, dispatched_at, api, webhook_ids[], last_webhook_at, last_polled_at, last_poll_status, … }. '
  'Written by fix-worker (dispatch), cursor-webhook (dedupe) and agent-status-poll.';
COMMENT ON COLUMN public.fix_attempts.github_task_id IS
  'GitHub Copilot Agent Tasks task id for github_cloud_agent attempts (X-GitHub-Api-Version 2026-03-10).';
COMMENT ON COLUMN public.fix_attempts.github_task_url IS
  'html_url of the GitHub agent task (the run page on github.com).';
COMMENT ON COLUMN public.fix_attempts.branch_name IS
  'Branch the cloud agent was asked to push to, or the head_ref learned from the vendor while polling. '
  'webhooks-github-indexer matches pull_request.head.ref against it while pr_url is still NULL.';

-- 3. Indexes ------------------------------------------------------------------
-- Poller scan: open cloud attempts that have not produced a PR yet.
CREATE INDEX IF NOT EXISTS idx_fix_attempts_agent_status_open
  ON public.fix_attempts (agent, status)
  WHERE pr_url IS NULL;

-- GitHub indexer head-ref fallback.
CREATE INDEX IF NOT EXISTS idx_fix_attempts_branch_name_open
  ON public.fix_attempts (branch_name)
  WHERE branch_name IS NOT NULL AND pr_url IS NULL;

-- cursor-webhook lookup: (project, agent id).
CREATE INDEX IF NOT EXISTS idx_fix_attempts_cursor_agent
  ON public.fix_attempts (project_id, cursor_agent_id)
  WHERE cursor_agent_id IS NOT NULL;
