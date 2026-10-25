import { describe, expect, it } from 'vitest'
import { EMPTY_FIXES_STATS, type FixesStats } from '../../components/fixes/FixesStatsTypes'
import { completedDetail, failedDetail } from './fixes'

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

describe('failedDetail', () => {
  it('names the top cause\u2019s share, never the whole bucket (report 990ba21a)', () => {
    // The banner breaks the same 51 down as CI failed (24), Needs your
    // decision (11), Agent found nothing to change (9). The caption used to
    // read a bare "CI failed" under the 51.
    expect(
      failedDetail(stats({ failed: 51, topFailureCategory: 'ci_failed', topFailureCount: 24 })),
    ).toBe('24 of 51 CI failed')
  })

  it('names the cause alone when it accounts for every stopped report', () => {
    expect(
      failedDetail(stats({ failed: 24, topFailureCategory: 'ci_failed', topFailureCount: 24 })),
    ).toBe('CI failed')
  })

  it('falls back when the server sent no breakdown', () => {
    expect(failedDetail(stats({ failed: 3 }))).toBe('needs attention')
    expect(failedDetail(stats({ failed: 3, topFailureCategory: 'ci_failed', topFailureCount: 0 }))).toBe(
      'needs attention',
    )
  })
})
