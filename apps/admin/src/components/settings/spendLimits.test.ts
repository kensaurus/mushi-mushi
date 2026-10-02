import { describe, expect, it } from 'vitest'
import { buildLimitsPatch, formatLimit, parseLimit, SPEND_LIMITS } from './spendLimits'

const usd = { unit: 'usd' as const }
const count = { unit: 'count' as const }

describe('spend limits', () => {
  it('covers the four limits the server accepts, each with a label and help', () => {
    expect(SPEND_LIMITS.map((m) => m.field).sort()).toEqual([
      'autofix_approval_cost_threshold_usd',
      'autofix_max_dispatches_per_day',
      'autofix_max_spend_usd',
      'monthly_llm_budget_usd',
    ])
    for (const m of SPEND_LIMITS) {
      expect(m.label.length).toBeGreaterThan(5)
      expect(m.help).toMatch(/empty/i)
    }
  })

  it('empty means no limit; dollars round to cents; a $ sign is fine', () => {
    expect(parseLimit(usd, '')).toEqual({ ok: true, value: null })
    expect(parseLimit(usd, '  ')).toEqual({ ok: true, value: null })
    expect(parseLimit(usd, '$2')).toEqual({ ok: true, value: 2 })
    expect(parseLimit(usd, '2.345')).toEqual({ ok: true, value: 2.35 })
  })

  it('rejects zero, negatives, text and out-of-range values', () => {
    expect(parseLimit(usd, '0').ok).toBe(false)
    expect(parseLimit(usd, '-1').ok).toBe(false)
    expect(parseLimit(usd, 'two').ok).toBe(false)
    expect(parseLimit(usd, '100001').ok).toBe(false)
    expect(parseLimit(count, '1.5').ok).toBe(false)
    expect(parseLimit(count, '0').ok).toBe(false)
    expect(parseLimit(count, '3')).toEqual({ ok: true, value: 3 })
  })

  it('sends only changed fields, and nothing when any input is invalid', () => {
    const saved = { autofix_max_spend_usd: 2, autofix_max_dispatches_per_day: 3, monthly_llm_budget_usd: null }
    expect(
      buildLimitsPatch({ autofix_max_spend_usd: '2', autofix_max_dispatches_per_day: '5', monthly_llm_budget_usd: '20' }, saved),
    ).toEqual({ patch: { autofix_max_dispatches_per_day: 5, monthly_llm_budget_usd: 20 }, errors: {} })
    // Clearing a field sends null (no limit).
    expect(buildLimitsPatch({ autofix_max_spend_usd: '' }, saved)).toEqual({
      patch: { autofix_max_spend_usd: null },
      errors: {},
    })
    const bad = buildLimitsPatch({ autofix_max_spend_usd: '-1', monthly_llm_budget_usd: '20' }, saved)
    expect(bad.patch).toEqual({})
    expect(bad.errors.autofix_max_spend_usd).toMatch(/above \$0/)
  })

  it('shows saved values as plain numbers and no limit as empty', () => {
    expect(formatLimit(2)).toBe('2')
    expect(formatLimit(null)).toBe('')
    expect(formatLimit(undefined)).toBe('')
  })
})
