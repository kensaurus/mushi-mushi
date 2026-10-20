import { describe, expect, it } from 'vitest'
import { EMPTY_FIXES_STATS, type FixesStats } from '../../components/fixes/FixesStatsTypes'
import { completedDetail } from './fixes'

const stats = (over: Partial<FixesStats>): FixesStats => ({ ...EMPTY_FIXES_STATS, hasAnyProject: true, ...over })

describe('completedDetail', () => {
  it('names the open PRs instead of "no finished runs" (tsumagoi, 2026-10-20)', () => {
    expect(completedDetail(stats({ completed: 0, failed: 0, prsOpen: 1 }))).toBe('1 PR waiting to merge')
    expect(completedDetail(stats({ completed: 0, failed: 0, prsOpen: 3 }))).toBe('3 PRs waiting to merge')
  })

  it('keeps the fixed-of-finished ratio and the empty state', () => {
    expect(completedDetail(stats({ completed: 2, failed: 1, prsOpen: 4 }))).toBe('2 of 3 reports fixed')
    expect(completedDetail(stats({}))).toBe('no finished runs')
  })
})
