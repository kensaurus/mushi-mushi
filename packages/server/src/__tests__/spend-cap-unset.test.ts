/**
 * `_shared/radar.ts` detectSpendCapUnset (Plan 020 §4.2 #10, gap #6): a NULL
 * auto-fix cap or a NULL monthly AI budget is a finding, whether auto-fix is
 * on or off, and the suggestion is safe to apply with one click.
 */
import { describe, expect, it } from 'vitest'
import {
  detectSpendCapUnset,
  MIN_SUGGESTED_MONTHLY_LLM_BUDGET_USD,
  suggestMonthlyLlmBudgetUsd,
} from '../../supabase/functions/_shared/radar.ts'
import { SPEND_LIMIT_FIELDS, validateSpendLimit } from '../../supabase/functions/_shared/autofix-budget.ts'

const capped = { autofix_enabled: true, autofix_max_spend_usd: 2, autofix_max_dispatches_per_day: 3, monthly_llm_budget_usd: 20 }

describe('detectSpendCapUnset', () => {
  it('is silent only when every cap and the budget are set', () => {
    expect(detectSpendCapUnset(capped)).toEqual([])
    expect(detectSpendCapUnset({ ...capped, autofix_enabled: false })).toEqual([])
  })

  it('flags a missing monthly AI budget even with auto-fix off and every auto-fix cap set', () => {
    const [f] = detectSpendCapUnset({ ...capped, autofix_enabled: false, monthly_llm_budget_usd: null, llm_spend_30d_usd: 0 })
    expect(f).toMatchObject({ rule_id: 'spend_cap_unset', severity: 'warn' })
    expect(f.message).toMatch(/No monthly AI budget/)
    expect(f.suggested_fix?.values).toEqual({ monthly_llm_budget_usd: MIN_SUGGESTED_MONTHLY_LLM_BUDGET_USD })
  })

  it('does not skip auto-fix-off projects: missing auto-fix caps are info there, warn when it is on', () => {
    const off = detectSpendCapUnset({ ...capped, autofix_enabled: false, autofix_max_spend_usd: null, autofix_max_dispatches_per_day: null })
    expect(off).toHaveLength(1)
    expect(off[0].severity).toBe('info')
    expect(off[0].message).toMatch(/Auto-fix is off/)
    const on = detectSpendCapUnset({ ...capped, autofix_max_dispatches_per_day: null })
    expect(on[0].severity).toBe('warn')
    expect(on[0].message).toMatch(/Auto-fix is on with no daily dispatch cap./)
  })

  it('suggests only the missing fields, as a PATCH /v1/admin/settings body the server accepts', () => {
    const [f] = detectSpendCapUnset({ autofix_enabled: true, autofix_max_spend_usd: 7, autofix_max_dispatches_per_day: null, monthly_llm_budget_usd: null, llm_spend_30d_usd: 31 })
    expect(f.suggested_fix).toMatchObject({ method: 'PATCH', endpoint: '/v1/admin/settings', path: '/settings?tab=general#spend-limits' })
    const values = f.suggested_fix?.values as Record<string, number>
    expect(values).toEqual({ autofix_max_dispatches_per_day: 3, monthly_llm_budget_usd: 65 })
    for (const [field, value] of Object.entries(values)) {
      expect((SPEND_LIMIT_FIELDS as readonly string[]).includes(field), field).toBe(true)
      expect(validateSpendLimit(field as (typeof SPEND_LIMIT_FIELDS)[number], value).ok, field).toBe(true)
    }
  })
})

describe('suggestMonthlyLlmBudgetUsd', () => {
  it('is about twice the recent spend, rounded up to $5, never below the floor', () => {
    expect(suggestMonthlyLlmBudgetUsd(null)).toBe(10)
    expect(suggestMonthlyLlmBudgetUsd(0)).toBe(10)
    expect(suggestMonthlyLlmBudgetUsd(4.99)).toBe(10)
    expect(suggestMonthlyLlmBudgetUsd(12.4)).toBe(25)
    expect(suggestMonthlyLlmBudgetUsd(100)).toBe(200)
    expect(suggestMonthlyLlmBudgetUsd(Number.NaN)).toBe(10)
  })

  it('never suggests a budget below what the project already spends', () => {
    for (const spend of [0.5, 9.99, 10, 47.3, 333.33]) {
      expect(suggestMonthlyLlmBudgetUsd(spend)).toBeGreaterThan(spend)
    }
  })
})
