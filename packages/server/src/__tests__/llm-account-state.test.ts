/**
 * An LLM call that fails because of the account's state (over the monthly AI
 * budget, or every key out of provider quota) is expected, already shown in
 * the console, and must not page Sentry once per report.
 *
 * MUSHI-MUSHI-SERVER-3J (fast-filter, 84 events), -3N (judge-batch) and -3K
 * (mistake-clusterer), 2026-10-29..31.
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isLlmAccountState, isLlmBudgetExceeded } from '../../supabase/functions/_shared/llm-account-state.ts'

const functionsDir = resolve(__dirname, '../../supabase/functions')
const read = (rel: string) => readFileSync(resolve(functionsDir, rel), 'utf-8')

/** The message LlmBudgetExceededError builds (llm-budget.ts). */
const BUDGET_MSG =
  'llm_budget_exceeded: this project has spent $50.02 of its $50.00 monthly LLM budget, so Mushi stopped ' +
  'calling the model. Raise the budget on the Costs page, or it resets on 2026-11-01.'

function budgetError(): Error {
  const e = new Error(BUDGET_MSG) as Error & { code: string }
  e.name = 'LlmBudgetExceededError'
  e.code = 'LLM_BUDGET_EXCEEDED'
  return e
}

function failoverError(lastError: string): Error {
  const e = new Error(`LLM failover: ALL_KEYS_EXHAUSTED ... Last error: ${lastError}`) as Error & {
    code: string
    lastError: string
  }
  e.name = 'LlmFailoverError'
  e.code = 'ALL_KEYS_EXHAUSTED'
  e.lastError = lastError
  return e
}

describe('isLlmBudgetExceeded', () => {
  it('matches the budget error by name, by code, and by its message', () => {
    expect(isLlmBudgetExceeded(budgetError())).toBe(true)
    expect(isLlmBudgetExceeded({ code: 'LLM_BUDGET_EXCEEDED' })).toBe(true)
    // judge-batch saw only the message after the AI SDK wrapper (3N).
    expect(isLlmBudgetExceeded(new Error(BUDGET_MSG))).toBe(true)
    expect(isLlmBudgetExceeded(BUDGET_MSG)).toBe(true)
  })

  it('does not match other failures', () => {
    expect(isLlmBudgetExceeded(new Error('No object generated'))).toBe(false)
    expect(isLlmBudgetExceeded(new Error('[401] invalid x-api-key'))).toBe(false)
    expect(isLlmBudgetExceeded(null)).toBe(false)
    expect(isLlmBudgetExceeded(undefined)).toBe(false)
  })
})

describe('isLlmAccountState', () => {
  it('is true over budget', () => {
    expect(isLlmAccountState(budgetError())).toBe(true)
  })

  it('is true when every key ran out of provider quota (Anthropic 400 "usage limits", 3C/3D)', () => {
    expect(
      isLlmAccountState(
        failoverError(
          '400 invalid_request_error: You have reached your specified API usage limits. You will regain access on 2026-11-01 at 00:00 UTC.',
        ),
      ),
    ).toBe(true)
    expect(isLlmAccountState(failoverError('429 rate limit exceeded'))).toBe(true)
  })

  it('is false when the pool ran out on an auth failure, which is still a fault to report', () => {
    expect(isLlmAccountState(failoverError('401 invalid x-api-key'))).toBe(false)
  })

  it('is false for NO_KEYS_CONFIGURED and plain errors', () => {
    const noKeys = Object.assign(new Error('LLM failover: NO_KEYS_CONFIGURED'), {
      name: 'LlmFailoverError',
      code: 'NO_KEYS_CONFIGURED',
      lastError: '',
    })
    expect(isLlmAccountState(noKeys)).toBe(false)
    expect(isLlmAccountState(new Error('schema validation failed'))).toBe(false)
  })
})

describe('call sites skip Sentry for an account state', () => {
  it('fast-filter only reports the heuristic fallback when it is not an account state (3J)', () => {
    const src = read('fast-filter/index.ts')
    expect(src).toContain("import { isLlmAccountState } from '../_shared/llm-account-state.ts'")
    expect(src).toMatch(/if \(!isLlmAccountState\(llmErr\)\) \{\s*reportError\(/)
  })

  it('judge-batch stops judging a project once it is over budget, with one warn (3N)', () => {
    const src = read('judge-batch/index.ts')
    expect(src).toContain("import { isLlmBudgetExceeded } from '../_shared/llm-account-state.ts'")
    expect(src).toMatch(/if \(budgetExceeded\) return/)
    const catchAt = src.indexOf('if (isLlmBudgetExceeded(err))')
    expect(catchAt).toBeGreaterThan(-1)
    // The budget branch returns before the error log.
    expect(catchAt).toBeLessThan(src.indexOf("error('Failed to evaluate report'"))
  })

  it('mistake-clusterer skips a cluster with no usable key at warn level (3K)', () => {
    const src = read('mistake-clusterer/index.ts')
    expect(src).toContain('if (!anthropicKey) throw new NoProjectLlmKeyError()')
    const skipAt = src.indexOf('if (err instanceof NoProjectLlmKeyError)')
    expect(skipAt).toBeGreaterThan(-1)
    expect(skipAt).toBeLessThan(src.indexOf("log.error('coherence judge failed'"))
    expect(src.slice(skipAt, src.indexOf("log.error('coherence judge failed'"))).toContain('log.warn(')
  })
})
