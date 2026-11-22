/**
 * The cost table's per-repo cap (2026-11-06): one-job runners that do not
 * group made 251 rows, about 43,000 px. A collapsed repo shows its busiest
 * rows, and always every row someone must act on.
 */

import { describe, expect, it } from 'vitest'
import type { CiCompareRow } from '../../lib/ciCompareTypes'
import { COMPARE_ROWS_PER_REPO, visibleCompareRows } from './CiCompareTable'

const row = (key: string, over: Partial<CiCompareRow> = {}): CiCompareRow =>
  ({ key, repo: 'kensaurus/app', runnerClass: 'self_hosted', jobs: 1, expired: 0, ...over }) as CiCompareRow

describe('visibleCompareRows', () => {
  it('shows every row when there are few', () => {
    const rows = [row('a'), row('b')]
    expect(visibleCompareRows(rows, false)).toEqual({ rows, hidden: 0 })
  })

  it('shows the first rows up to the cap and counts the rest', () => {
    const rows = Array.from({ length: 30 }, (_, i) => row(`r${i}`))
    const v = visibleCompareRows(rows, false)
    expect(v.rows.map((r) => r.key)).toEqual(rows.slice(0, COMPARE_ROWS_PER_REPO).map((r) => r.key))
    expect(v.hidden).toBe(30 - COMPARE_ROWS_PER_REPO)
  })

  it('never hides a row that needs attention, and keeps the original order', () => {
    const rows = [
      ...Array.from({ length: 10 }, (_, i) => row(`r${i}`)),
      row('never-picked', { runnerClass: 'unknown', jobs: 53 }),
      row('expired', { expired: 4 }),
    ]
    const v = visibleCompareRows(rows, false)
    expect(v.rows.map((r) => r.key)).toEqual(['r0', 'r1', 'r2', 'r3', 'never-picked', 'expired'])
    expect(v.hidden).toBe(6)
  })

  it('shows everything once expanded', () => {
    const rows = Array.from({ length: 12 }, (_, i) => row(`r${i}`))
    expect(visibleCompareRows(rows, true)).toEqual({ rows, hidden: 0 })
  })
})
