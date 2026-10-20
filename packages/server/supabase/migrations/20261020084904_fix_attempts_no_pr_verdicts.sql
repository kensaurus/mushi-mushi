-- Migration: 20261020084904_fix_attempts_no_pr_verdicts
-- Purpose: A cloud agent that finishes without a PR usually says why. Two
--          verdicts get their own failure bucket instead of cursor_api_error
--          (_shared/cloud-agent-no-pr.ts):
--   already_fixed — the agent found the bug already fixed on the default
--                   branch, or not reproducible on the current deploy.
--   wrong_repo    — the code lives in another repo than the one dispatched.
-- Seen 2026-10-20: six of eight Cursor runs on the dogfood apps, all filed as
-- API errors with a Retry button that would spend the same credits again.

ALTER TABLE public.fix_attempts
  DROP CONSTRAINT IF EXISTS fix_attempts_failure_category_check;

ALTER TABLE public.fix_attempts
  ADD CONSTRAINT fix_attempts_failure_category_check
  CHECK (
    failure_category IS NULL OR failure_category = ANY (ARRAY[
      'sandbox_timeout',
      'sandbox_error',
      'validation_rejected',
      'spec_violation',
      'scope_blocked',
      'llm_invalid_json',
      'llm_no_object',
      'llm_rate_limit',
      'llm_schema_violation',
      'llm_other_error',
      'github_403',
      'github_404',
      'github_422',
      'github_other_error',
      'cursor_api_error',
      'cursor_invalid_model',
      'cursor_validation_error',
      'embedding_provider_html_response',
      'upstream_internal_server',
      'no_relevant_code',
      'context_assembly_failed',
      'unknown',
      'claude_api_error',
      'claude_workflow_missing',
      'claude_repo_dispatch_failed',
      'already_fixed',
      'wrong_repo'
    ])
  );

COMMENT ON COLUMN public.fix_attempts.failure_category IS
  'Structured failure bucket for diagnostic dashboards.
   cursor_api_error: Cursor Cloud API 4xx/5xx.
   claude_api_error: Anthropic API error during dispatch.
   claude_workflow_missing: .github/workflows/mushi-claude-fix.yml not found.
   claude_repo_dispatch_failed: GitHub repository_dispatch POST returned 4xx/5xx.
   already_fixed: the cloud agent found nothing to change (fixed on main, or not reproducible).
   wrong_repo: the cloud agent says the code is in another repo than the one dispatched.
   NULL means the attempt has not failed yet.';
