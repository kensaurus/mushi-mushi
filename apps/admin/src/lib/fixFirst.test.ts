import { describe, expect, it } from 'vitest'
import { bugQuestions, fixFirstOrder, peopleHit } from './fixFirst'

const r = (id: string, severity: string | null, users = 1, created_at = '2026-10-20T00:00:00Z', status = 'classified') => ({
  id,
  severity,
  unique_users: users,
  created_at,
  status,
})

describe('fixFirstOrder', () => {
  it('puts the worst severity first, then the bug that reached more people', () => {
    const order = fixFirstOrder([r('low-many', 'low', 40), r('high-one', 'high', 1), r('critical', 'critical', 1), r('high-ten', 'high', 10)])
    expect(order.map((x) => x.id)).toEqual(['high-ten', 'critical', 'low-many', 'high-one'])
  })

  it('leaves out reports whose fix is already on the way', () => {
    expect(fixFirstOrder([r('a', 'critical', 5, undefined, 'fixing'), r('b', 'low')]).map((x) => x.id)).toEqual(['b'])
  })

  it('breaks a tie with the newest report, and caps the list', () => {
    const order = fixFirstOrder(
      [r('old', 'medium', 1, '2026-10-01T00:00:00Z'), r('new', 'medium', 1, '2026-10-25T00:00:00Z'), ...Array.from({ length: 8 }, (_, i) => r(`x${i}`, 'low'))],
      3,
    )
    expect(order.map((x) => x.id)).toEqual(['new', 'old', 'x0'])
  })

  it('counts at least one person, and duplicates when users are unknown', () => {
    expect(peopleHit({})).toBe(1)
    expect(peopleHit({ dedup_count: 4 })).toBe(4)
  })
})

describe('bugQuestions', () => {
  it('asks about the top open bugs by title, worst first', () => {
    const qs = bugQuestions([
      { ...r('a', 'low'), title: 'Footer link is grey' },
      { ...r('b', 'critical'), title: 'Checkout total shows NaN' },
      { ...r('c', 'high'), title: null, summary: 'Lesson rail crashes' },
    ])
    expect(qs).toEqual([
      'Where in the code does "Checkout total shows NaN" come from?',
      'Where in the code does "Lesson rail crashes" come from?',
      'Where in the code does "Footer link is grey" come from?',
    ])
  })

  // Three reports with one title made three identical chips and a React duplicate-key error on Code map (2026-10-28).
  it('asks about a shared title once and fills up with the next bug', () => {
    const qs = bugQuestions([
      { ...r('a', 'high'), title: 'DbError: canceling statement' },
      { ...r('b', 'high'), title: 'DbError: canceling statement' },
      { ...r('c', 'high'), title: 'DbError: canceling statement' },
      { ...r('d', 'low'), title: 'Footer link is grey' },
    ])
    expect(qs).toEqual([
      'Where in the code does "DbError: canceling statement" come from?',
      'Where in the code does "Footer link is grey" come from?',
    ])
  })
})
