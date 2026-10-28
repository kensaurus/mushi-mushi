/**
 * FILE: packages/server/supabase/functions/fix-worker/failure-category.ts
 * PURPOSE: Map a fix-worker error onto fix_attempts.failure_category.
 *
 * OVERVIEW:
 * Pure string matching, split out of fix-worker/index.ts so tests can call
 * it without booting the edge function. Pattern order matters: more-specific
 * HTTP and vendor codes are checked before generic substrings.
 *
 * DEPENDENCIES:
 * - spend-down.ts (pinned-key message)
 *
 * USAGE:
 * fix-worker/index.ts calls categorizeFailure in the catch path. The vitest
 * snapshot calls it with a provider usage-cap message.
 *
 * NOTES:
 * `unknown` means no pattern matched. A monthly usage cap ("usage limit
 * reached") is llm_rate_limit, the same bucket as a 429.
 */
import { isSpendDownPinnedKeyUnavailable } from '../_shared/spend-down.ts';

export function categorizeFailure(err: unknown, msg: string): string {
  const m = (msg || '').toLowerCase();
  // Pinned spend-down key was already unusable. Same retry as a usage limit
  // (reportsToRetryAfterKeyLimit), and not a Sentry error.
  if (isSpendDownPinnedKeyUnavailable(msg)) return 'cursor_api_error';
  // AI-SDK structured-output failures — we throw `LLM call failed: …` and
  // the inner error name is in the message.
  if (m.includes('noobjectgeneratederror') || m.includes('no_object')) return 'llm_no_object';
  if (m.includes('aijsonparseerror') || m.includes('jsonparseerror')) return 'llm_invalid_json';
  if (
    m.includes('rate limit') ||
    m.includes('rate_limit') ||
    m.includes('429') ||
    m.includes('usage limit') ||
    m.includes('usage_limit')
  ) {
    return 'llm_rate_limit';
  }
  // Validation gates — thrown by us, not the model.
  if (m.startsWith('validation failed:')) {
    if (m.includes('outside scope')) return 'scope_blocked';
    if (m.includes('exceeds circuit breaker')) return 'validation_rejected';
    if (m.includes('token-shaped')) return 'spec_violation';
    return 'validation_rejected';
  }
  if (m.includes('does not match required pattern') && m.includes('branch name')) {
    return 'branch_naming';
  }
  // Spec/inventory checker (validateAgainstSpec).
  if (m.includes('spec violation') || m.includes('inventory contract')) return 'spec_violation';
  // Sandbox lifecycle — these can come from agents/sandbox or claude code adapters.
  if (m.includes('sandbox') && m.includes('timeout')) return 'sandbox_timeout';
  if (m.includes('sandbox')) return 'sandbox_error';
  // Cursor Cloud (agent-adapters.ts / cursor-cloud.ts). CursorApiError
  // messages start with "Cursor API <status> <code>:"; the key-missing
  // pre-flight says "Cursor API key not configured".
  if (m.includes('cursor api') || m.includes('cursor run') || m.includes('cursor agent')) {
    if (m.includes('invalid_model') || m.includes('invalid model')) return 'cursor_invalid_model';
    if (m.includes('validation_error')) return 'cursor_validation_error';
    return 'cursor_api_error';
  }
  // GitHub REST surface — every PR-creation path goes through Octokit and
  // throws a `Request failed with status code 4xx` Error.
  if (m.includes('github') || m.includes('octokit') || m.includes('pull_request')) {
    if (m.includes('403')) return 'github_403';
    if (m.includes('404')) return 'github_404';
    if (m.includes('422')) return 'github_422';
    return 'github_other_error';
  }
  // Context-floor gate / RAG.
  if (m.includes('skipped_no_context') || m.includes('no grounding context')) return 'no_relevant_code';
  if (m.includes('context assembly') || m.includes('rag failed')) return 'context_assembly_failed';
  // LLM call failed but we couldn't pattern-match the kind.
  if (m.startsWith('llm call failed') || m.includes('anthropic') || m.includes('openai')) {
    return 'llm_other_error';
  }
  return 'unknown';
}
