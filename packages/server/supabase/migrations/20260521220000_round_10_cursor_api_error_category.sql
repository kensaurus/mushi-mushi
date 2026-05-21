-- Migration: Round 10 — add cursor_api_error to fix_attempts.failure_category (2026-05-21)
--
-- Root cause: fix-worker was calling POST /v1/agents with a top-level `branchName`
-- field that the Cursor API v1 no longer accepts (removed in May 2026 schema update).
-- The error "Unrecognized key(s) in object: 'branchName'" was returned as a 400.
-- `branchName` has been removed from the request body; the desired name is now passed
-- via the MUSHI_BRANCH_NAME envVar so the agent's prompt can reference it.
--
-- This migration adds `cursor_api_error` to the failure_category enum so the fix-worker
-- can correctly classify Cursor Cloud API failures (4xx/5xx from api.cursor.com) in
-- fix_attempts.failure_category, enabling the SchemaRepairDiagnosticCard to surface them.

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
      'llm_other_error',
      'github_403',
      'github_404',
      'github_422',
      'github_other_error',
      'cursor_api_error',
      'no_relevant_code',
      'context_assembly_failed',
      'unknown'
    ])
  );

COMMENT ON COLUMN public.fix_attempts.failure_category IS
  'Structured failure bucket for diagnostic dashboards. cursor_api_error covers
   Cursor Cloud API 4xx/5xx responses (e.g. schema validation failures). NULL
   means the attempt has not failed yet.';
