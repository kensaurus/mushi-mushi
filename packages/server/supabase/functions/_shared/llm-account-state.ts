/**
 * FILE: packages/server/supabase/functions/_shared/llm-account-state.ts
 * PURPOSE: Tell an LLM call that failed because of the account's state from
 *          a fault worth paging on.
 *
 * Two states are expected and already shown to the owner:
 * - The project spent its monthly AI budget (LlmBudgetExceededError). The
 *   console shows it as the "Monthly AI budget" setup gap (llmBudgetGap).
 * - Every key in the pool hit its provider quota (LlmFailoverError
 *   ALL_KEYS_EXHAUSTED whose last error is a quota message). Each key is
 *   already marked quota_exhausted by withLlmFailover.
 *
 * Reported as errors they paged once per report: MUSHI-MUSHI-SERVER-3J (84
 * events, fast-filter) and -3N (judge-batch), 2026-10-29..31.
 *
 * Matched by name and code, not instanceof: pure, so tests and callers need
 * not load llm-budget.ts / llm-failover.ts and their module-level env reads.
 */
import { isQuotaMessage } from './llm-quota.ts'

type ErrorLike = { name?: unknown; code?: unknown; message?: unknown; lastError?: unknown }

/** True for LlmBudgetExceededError, or its message after a wrapper kept only the text. */
export function isLlmBudgetExceeded(err: unknown): boolean {
  if (typeof err === 'string') return err.startsWith('llm_budget_exceeded:')
  if (!err || typeof err !== 'object') return false
  const e = err as ErrorLike
  return (
    e.name === 'LlmBudgetExceededError' ||
    e.code === 'LLM_BUDGET_EXCEEDED' ||
    (typeof e.message === 'string' && e.message.startsWith('llm_budget_exceeded:'))
  )
}

/** Over budget, or every pooled key out of provider quota. */
export function isLlmAccountState(err: unknown): boolean {
  if (isLlmBudgetExceeded(err)) return true
  if (!err || typeof err !== 'object') return false
  const e = err as ErrorLike
  return (
    e.name === 'LlmFailoverError' &&
    e.code === 'ALL_KEYS_EXHAUSTED' &&
    typeof e.lastError === 'string' &&
    isQuotaMessage(e.lastError)
  )
}
