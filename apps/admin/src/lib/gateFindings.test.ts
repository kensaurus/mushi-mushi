import { describe, expect, it } from 'vitest'
import { describeSpendCaps, latestOpenFindings, spendCapSuggestion } from './gateFindings'
import { GATE_IDS, GATE_LABELS, gateLabel } from './gateLabels'

describe('latestOpenFindings', () => {
  it('keeps the newest finished run per gate, drops allowlisted, most severe first', () => {
    const out = latestOpenFindings({
      runs: [
        { id: 'r-running', gate: 'radar', status: 'running' },
        { id: 'r-new', gate: 'radar', status: 'warn' },
        { id: 'r-old', gate: 'radar', status: 'warn' },
        { id: 'c-1', gate: 'code_health', status: 'fail' },
      ],
      findings: [
        { id: 'a', gate_run_id: 'r-new', severity: 'info', message: 'a' },
        { id: 'b', gate_run_id: 'r-old', severity: 'error', message: 'b' },
        { id: 'c', gate_run_id: 'c-1', severity: 'error', message: 'c' },
        { id: 'd', gate_run_id: 'c-1', severity: 'warn', message: 'd', allowlisted: true },
      ],
    })
    expect(out.map((f) => [f.id, f.gate])).toEqual([['c', 'code_health'], ['a', 'radar']])
  })
})

describe('spendCapSuggestion', () => {
  it('reads only valid caps from a spend_cap_unset finding', () => {
    expect(spendCapSuggestion({ rule_id: 'spend_cap_unset', suggested_fix: { values: { monthly_llm_budget_usd: 10, autofix_max_spend_usd: -1, other: 4 } } }))
      .toEqual({ monthly_llm_budget_usd: 10 })
    expect(spendCapSuggestion({ rule_id: 'spend_cap_unset', suggested_fix: { values: { autofix_max_spend_usd: 0 } } })).toBeNull()
    expect(spendCapSuggestion({ rule_id: 'spend_cap_unset', suggested_fix: null })).toBeNull()
    expect(spendCapSuggestion({ rule_id: 'byok_key_invalid', suggested_fix: { values: { monthly_llm_budget_usd: 10 } } })).toBeNull()
  })

  it('describes each cap in plain English, saying what the budget stops', () => {
    const lines = describeSpendCaps({ monthly_llm_budget_usd: 25, autofix_max_dispatches_per_day: 3 })
    expect(lines).toHaveLength(2)
    expect(lines[0]).toMatch(/\$25.*stops/)
    expect(lines[1]).toBe('Automatic fixes per day: 3.')
  })
})

describe('gate labels', () => {
  it('labels every gate, including the setup and hole checks', () => {
    for (const gate of GATE_IDS) expect(GATE_LABELS[gate].length, gate).toBeGreaterThan(3)
    expect(gateLabel('radar')).toBe('Mushi setup checks')
    expect(gateLabel('store_review')).toBe('Store review checklist')
    expect(gateLabel('not_a_gate')).toBe('not_a_gate')
  })
})
