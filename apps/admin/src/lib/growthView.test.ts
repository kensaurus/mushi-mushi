import { describe, expect, it } from 'vitest'
import { headlineAllZero, isAllZero, orderWeeksAscending, shortDay, splitEmptyWeeks, stagesWithData } from './growthView'

describe('growthView (round-2 sweep 2026-11-18)', () => {
  it('puts weeks oldest → newest whatever order the server sends', () => {
    const newestFirst = [{ week_start: '2026-11-16' }, { week_start: '2026-11-09' }, { week_start: '2026-09-28' }]
    expect(orderWeeksAscending(newestFirst).map((w) => w.week_start)).toEqual(['2026-09-28', '2026-11-09', '2026-11-16'])
    expect(orderWeeksAscending([...newestFirst].reverse()).map((w) => w.week_start)).toEqual(['2026-09-28', '2026-11-09', '2026-11-16'])
  })

  it('keeps only stages with data and spots an empty series', () => {
    const weeks = [{ signups: 3, paid: 0, habit: 0 }, { signups: 0, paid: 0, habit: 0 }]
    expect(stagesWithData(['signups', 'habit', 'paid'] as const, weeks)).toEqual(['signups'])
    expect(isAllZero([0, 0, 0])).toBe(true)
    expect(isAllZero([0, 2])).toBe(false)
  })

  it('formats a bare UTC day in the short form', () => {
    expect(shortDay('2026-11-18')).toBe(new Date(Date.UTC(2026, 10, 18)).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' }))
  })
})

describe('growthView (round-3 sweep 2026-11-19)', () => {
  it('splits weeks that are 0 in every shown stage from the rest', () => {
    const weeks = [{ week_start: 'a', visits: 3, signups: 0 }, { week_start: 'b', visits: 0, signups: 0 }]
    const { filled, empty } = splitEmptyWeeks(weeks, ['visits', 'signups'] as const)
    expect(filled.map((w) => w.week_start)).toEqual(['a'])
    expect(empty.map((w) => w.week_start)).toEqual(['b'])
  })

  it('spots a week whose four headline tiles would all be 0', () => {
    expect(headlineAllZero({ signups: 0, projects: 0, activated: 0, paid: 0 })).toBe(true)
    expect(headlineAllZero({ signups: 1, projects: 0, activated: 0, paid: 0 })).toBe(false)
  })
})
