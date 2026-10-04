import { describe, expect, it } from 'vitest'
import { parseBudgetInput } from './budgetInput'

describe('parseBudgetInput', () => {
  it('sets a positive dollar amount', () => {
    expect(parseBudgetInput('50')).toEqual({ kind: 'set', value: 50 })
    expect(parseBudgetInput(' 12.50 ')).toEqual({ kind: 'set', value: 12.5 })
  })

  it('clears only on an empty field', () => {
    expect(parseBudgetInput('')).toEqual({ kind: 'clear' })
    expect(parseBudgetInput('   ')).toEqual({ kind: 'clear' })
  })

  it('treats typos as invalid instead of clearing the budget', () => {
    expect(parseBudgetInput('-5').kind).toBe('invalid')
    expect(parseBudgetInput('0').kind).toBe('invalid')
    expect(parseBudgetInput('abc').kind).toBe('invalid')
    expect(parseBudgetInput('5.555').kind).toBe('invalid')
  })
})
