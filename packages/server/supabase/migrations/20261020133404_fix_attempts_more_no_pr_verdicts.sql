-- Migration: 20261020133404_fix_attempts_more_no_pr_verdicts
-- Purpose: Two more no-PR verdicts (_shared/cloud-agent-no-pr.ts):
--   not_actionable — the agent found no defect the evidence can tie to code
--                    (a stackless event, a log line from an outside tool).
--   needs_human    — the agent stopped for a product, design or account
--                    decision only a person can make.
-- Seen 2026-10-20 afternoon: nine runs like these filed as cursor_api_error.

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
      'wrong_repo',
      'not_actionable',
      'needs_human'
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
   not_actionable: the cloud agent found no defect the evidence can tie to code.
   needs_human: the cloud agent stopped for a decision only a person can make.
   NULL means the attempt has not failed yet.';
