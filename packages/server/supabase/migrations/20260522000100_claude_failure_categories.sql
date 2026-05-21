-- Migration: 20260522000100_claude_failure_categories
-- Purpose: Extend fix_attempts.failure_category CHECK to include Claude Code
--          Agent-specific failure buckets so the SchemaRepairDiagnosticCard
--          and the "Why fixes failed" tile can surface them distinctly from
--          cursor_api_error and the existing LLM/GitHub categories.
--
-- New values:
--   claude_api_error           — Anthropic API returned an error (auth, rate-limit, etc.)
--   claude_workflow_missing    — The mushi-claude-fix workflow was not found in the repo
--   claude_repo_dispatch_failed — GitHub repo dispatch POST returned 4xx/5xx

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
      'claude_repo_dispatch_failed'
    ])
  );

COMMENT ON COLUMN public.fix_attempts.failure_category IS
  'Structured failure bucket for diagnostic dashboards.
   cursor_api_error: Cursor Cloud API 4xx/5xx.
   claude_api_error: Anthropic API error during dispatch.
   claude_workflow_missing: .github/workflows/mushi-claude-fix.yml not found.
   claude_repo_dispatch_failed: GitHub repository_dispatch POST returned 4xx/5xx.
   NULL means the attempt has not failed yet.';
