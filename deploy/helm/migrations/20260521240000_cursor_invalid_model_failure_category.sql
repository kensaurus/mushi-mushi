-- Migration: R11 — broaden fix_attempts.failure_category with cursor_invalid_model + provider-side enums (2026-05-21)
--
-- Root cause #1: 2026-05-21 03:26 UTC outage — a user's saved
-- cursor_default_model='claude-4-sonnet' is rejected by the Cursor API with
-- HTTP 400 invalid_model. The previous round bucketed every Cursor failure
-- into 'cursor_api_error', so the SchemaRepairDiagnosticCard could not route
-- the user to the model dropdown specifically. fix-worker (this round) now
-- regex-discriminates `invalid_model`; this migration accepts the new value.
--
-- Root cause #2: Sentry shows three additional patterns we cannot currently
-- record because the constraint rejects them:
--   * embedding_provider_html_response  — OpenRouter 404 returns HTML; the
--     parser throws `Unexpected token '<', "<!DOCTYPE …"`. 74 lifetime events.
--   * upstream_internal_server          — provider 500 with body
--     "Internal Server Error". Hits 3 routes.
--   * llm_schema_violation              — JSON-parseable LLM response that
--     fails zod validation (distinct from llm_no_object which is the AI-SDK
--     structured-output failure).
--
-- Also adds 'cursor_validation_error' for non-invalid_model Cursor 4xx that
-- categorizeFailure already returns via the fall-through.

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
      'unknown'
    ])
  );

COMMENT ON COLUMN public.fix_attempts.failure_category IS
  'Structured failure bucket for diagnostic dashboards. Categories with
   actionable user remediation: cursor_invalid_model (route to model
   dropdown), cursor_api_error (re-save API key), github_* (re-save token /
   check repo URL), llm_schema_violation (retry — schema-repair will handle).
   NULL means the attempt has not failed yet.';
